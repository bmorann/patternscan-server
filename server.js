const express=require("express"),http=require("http"),WebSocket=require("ws"),cors=require("cors"),https_mod=require("https");
const app=express(),server=http.createServer(app),wss=new WebSocket.Server({server});
const PORT=process.env.PORT||3000,signals=[],clients=new Set();
let cachedPrices={},cacheTime=0;
app.use(cors());app.use(express.json());
wss.on("connection",ws=>{clients.add(ws);ws.send(JSON.stringify({type:"history",signals:signals.slice(-50)}));ws.on("close",()=>clients.delete(ws));});
function broadcast(msg){const d=JSON.stringify(msg);for(const c of clients)if(c.readyState===WebSocket.OPEN)c.send(d);}
app.post("/webhook",(req,res)=>{const b=req.body;if(!b.pattern||!b.symbol)return res.status(400).json({error:"Missing"});const s={id:Date.now()+"-"+Math.random().toString(36).slice(2),pattern:b.pattern,symbol:b.symbol.toUpperCase(),tf:b.tf||"?",price:b.price?parseFloat(b.price).toFixed(2):null,time:b.time||new Date().toISOString()};signals.push(s);if(signals.length>500)signals.shift();broadcast({type:"signal",signal:s});res.json({ok:true});});
app.get("/signals",(req,res)=>res.json({signals:signals.slice(-50)}));
app.get("/health",(req,res)=>res.json({status:"ok",signals:signals.length,clients:clients.size,uptime:process.uptime()}));
app.get("/prices",(req,res)=>{
const syms=(req.query.symbols||"AAPL,TSLA,NVDA,AMD,GOOGL,AMZN,SPY,QQQ,CRCL").toUpperCase();
if(Date.now()-cacheTime<15000&&Object.keys(cachedPrices).length>0)return res.json({ok:true,prices:cachedPrices,cached:true});
const opts={hostname:"query1.finance.yahoo.com",path:"/v8/finance/quote?symbols="+encodeURIComponent(syms)+"&fields=regularMarketPrice,regularMarketChangePercent,regularMarketVolume,regularMarketPreviousClose,shortName",headers:{"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36","Accept":"application/json","Referer":"https://finance.yahoo.com/"}};
https_mod.get(opts,r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{try{const j=JSON.parse(d),results=j?.quoteResponse?.result||[],prices={};results.forEach(q=>{prices[q.symbol]={price:parseFloat((q.regularMarketPrice||0).toFixed(2)),change:parseFloat((q.regularMarketChangePercent||0).toFixed(2)),volume:q.regularMarketVolume||0,prev:q.regularMarketPreviousClose||0,name:q.shortName||q.symbol};});cachedPrices=prices;cacheTime=Date.now();res.setHeader("Access-Control-Allow-Origin","*");res.json({ok:true,prices,count:results.length});}catch(e){res.json({ok:false,error:e.message,raw:d.slice(0,100)});}});}).on("error",e=>res.json({ok:false,error:e.message}));
});
server.listen(PORT,()=>console.log("PatternScan on :"+PORT+" - /prices live"));
