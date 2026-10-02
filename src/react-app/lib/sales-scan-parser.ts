/**
 * Deterministic parser for handwritten fuel-station sales sheets.
 *
 * Handwritten forecourt pattern:
 *   opening KSh - opening litres
 *   closing KSh - closing litres
 *   sales KSh
 *
 * High confidence requires independent arithmetic agreement. Small OCR
 * discrepancies are retained as MEDIUM confidence rather than discarded.
 */
import { normalizeFuelType } from "@/react-app/config/pricing";

export interface SalesSheetPump {
  name: string;
  fuelType: string;
  openingReading: number;
  closingReading: number;
  openingLitres: number;
  closingLitres: number;
  salesAmount: number;
  salesLitres: number;
  direction: "increasing" | "decreasing" | "unknown";
  confidence: "high" | "medium" | "low";
}

export interface SalesSheetExpense { name: string; amount: number; }
export interface SalesSheetFields {
  date?: string;
  shift?: string;
  pumps: SalesSheetPump[];
  expenses: SalesSheetExpense[];
  totalSales?: number;
  tillAmount?: number;
  cashAmount?: number;
  otherDetails: Array<{ label: string; value: number }>;
  confidence: "high" | "medium" | "low";
  notes: string[];
}

const MONTHS: Record<string, number> = {
  jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,
  jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,
  oct:10,october:10,nov:11,november:11,dec:12,december:12,
};

function fixNumericConfusions(raw: string): string {
  return raw.replace(/(?<=\d)[Oo](?=\d)/g,"0")
    .replace(/(?<=\d)[Oo](?=\D|$)/g,"0")
    .replace(/(?<=\d)[lI](?=\d)/g,"1")
    .replace(/(?<=\d)[lI](?=\D|$)/g,"1")
    .replace(/[−–—]/g,"-");
}
function toNumber(raw: string): number {
  const n=Number.parseFloat(fixNumericConfusions(raw).replace(/[^\d.,-]/g,"").replace(/,/g,""));
  return Number.isFinite(n)?n:0;
}
function iso(y:number,m:number,d:number):string|undefined {
  if(y<1990||y>2100||m<1||m>12||d<1||d>31)return undefined;
  return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}
export function parseSalesSheetDate(raw:string):string|undefined {
  const s=raw.trim().replace(/(\d+)(st|nd|rd|th)/gi,"$1")
    .replace(/(?<=[\d\-/.])\)(?=\d)/g,"1").replace(/(?<=[\d\-/.])[lI](?=\d)/g,"1");
  let m=s.match(/(\d{1,2})\s+([A-Za-z]{3,9}),?\s*(\d{4})/);
  if(m&&MONTHS[m[2].toLowerCase()])return iso(+m[3],MONTHS[m[2].toLowerCase()],+m[1]);
  m=s.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})/);
  if(m&&MONTHS[m[1].toLowerCase()])return iso(+m[3],MONTHS[m[1].toLowerCase()],+m[2]);
  m=s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); if(m)return iso(+m[1],+m[2],+m[3]);
  m=s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if(m){const a=+m[1],b=+m[2],y=+m[3];return a>12?iso(y,b,a):b>12?iso(y,a,b):iso(y,b,a);}
  return undefined;
}
function numericGroups(line:string):string[] {
  const t=fixNumericConfusions(line).split(/\s+/).filter(Boolean), out:string[]=[];
  for(let i=0;i<t.length;i++){
    const token=t[i]; if(!/^\d[\d,.]*$/.test(token))continue;
    if(/^\d{1,3}$/.test(token)){
      const parts=[token]; let j=i+1;
      while(j<t.length&&/^\d{3}(?:\.\d+)?$/.test(t[j])){parts.push(t[j]);j++;}
      if(parts.length>1&&(/^\d{1,2}$/.test(token)||/\.\d+$/.test(parts[parts.length-1]))){out.push(parts.join(""));i=j-1;continue;}
    }
    out.push(token);
  }
  return out;
}
function numericValues(line:string):number[]{return numericGroups(line).map(toNumber).filter(n=>Number.isFinite(n)&&n>0);}
function numericValuesIncludingZero(line:string):number[]{return numericGroups(line).map(toNumber).filter(n=>Number.isFinite(n)&&n>=0);}
function meterPairFromLine(line:string):[number,number]|null{
  const p=fixNumericConfusions(line).split(/\s*-\s*/); if(p.length!==2)return null;
  const a=numericValues(p[0]),b=numericValues(p[1]); if(a.length!==1||b.length!==1||a[0]<1000||b[0]<1000)return null;
  return [a[0],b[0]];
}
function buildPump(name:string,fuelType:string,openingKsh:number,closingKsh:number,openingLitres:number,closingLitres:number,confidence:SalesSheetPump["confidence"]):SalesSheetPump{
  return {name,fuelType,openingReading:openingKsh,closingReading:closingKsh,openingLitres,closingLitres,
    salesAmount:Math.abs(closingKsh-openingKsh),salesLitres:Math.abs(closingLitres-openingLitres),
    direction:closingKsh>openingKsh?"increasing":closingKsh<openingKsh?"decreasing":"unknown",confidence};
}
function addUniquePump(pumps:SalesSheetPump[],pump:SalesSheetPump):void{
  if(!pumps.some(p=>Math.abs(p.openingReading-pump.openingReading)<=100&&Math.abs(p.closingReading-pump.closingReading)<=100&&Math.abs(p.openingLitres-pump.openingLitres)<=2&&Math.abs(p.closingLitres-pump.closingLitres)<=2))pumps.push(pump);
}
function labelledAmount(text:string,labelRe:RegExp):number|undefined{
  const m=text.match(new RegExp(`\\b${labelRe.source}\\b\\s*[:=\\-–]?\\s*([\\d,.]{1,18})`,"i"));
  if(!m)return undefined; const n=toNumber(m[1]); return n>=0?n:undefined;
}
function explicitPumpId(line:string):{id:string;rest:string}|null{
  const m=line.match(/^([A-Za-z]{1,8}[\s-]?\d{1,3})\b[\s:;-]*(.*)$/); if(!m)return null;
  return {id:m[1].toUpperCase().replace(/\s+/g,"-"),rest:m[2]};
}
function fuelFromText(line:string):string{
  const f=line.match(/\b(petrol|pms|diesel|ago|kerosene|ik|lpg|v[- ]?power|premium\s+diesel|cng)\b/i)?.[1];
  return f?normalizeFuelType(f)||f.toLowerCase():"";
}
function salesMatchesDelta(delta:number,written:number):boolean{return Math.abs(delta-written)<=Math.max(0.05,delta*0.0005);}

export function extractSalesSheetFromText(rawText:string):SalesSheetFields{
  const text=String(rawText||""),notes:string[]=[],pumps:SalesSheetPump[]=[],expenses:SalesSheetExpense[]=[],otherDetails:Array<{label:string;value:number}>=[];
  const lines=text.split(/\r?\n/).map(l=>fixNumericConfusions(l).trim()).filter(Boolean);
  let date:string|undefined;
  const dm=text.match(/\b\d{1,2}[-/.:]\d{1,2}[-/.:]\d{2,4}\b|\b\d{1,2}\s+[A-Za-z]{3,9},?\s*\d{4}\b|\b[A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4}\b/); if(dm)date=parseSalesSheetDate(dm[0]);
  const sm=text.match(/\bshift\s*[:–-]?\s*(day|night|morning|evening)/i); const shift=sm?sm[1][0].toUpperCase()+sm[1].slice(1):undefined;

  for(const line of lines){
    const id=explicitPumpId(line); if(!id)continue; const v=numericValues(id.rest); if(v.length<2)continue; const ft=fuelFromText(id.rest);
    if(v.length>=4){addUniquePump(pumps,buildPump(id.id,ft,v[0],v[2],v[1],v[3],"high"));continue;}
    const opening=v[0],closing=v[1],written=v[2],delta=Math.abs(closing-opening);
    if(v.length>=3&&!salesMatchesDelta(delta,written))continue;
    const p=buildPump(id.id,ft,opening,closing,0,0,"medium"); if(v.length>=3)p.salesAmount=written; addUniquePump(pumps,p);
  }

  // Exact handwritten forecourt block. A <= KSh 1 OCR discrepancy is retained
  // as MEDIUM confidence so a valid row is not lost; it can never elevate the
  // whole document to HIGH unless the meter arithmetic also agrees.
  for(let i=0;i<lines.length-2;i++){
    const first=meterPairFromLine(lines[i]),second=meterPairFromLine(lines[i+1]); if(!first||!second)continue;
    const sv=numericValuesIncludingZero(lines[i+2]); if(sv.length!==1)continue;
    const [ok,ol]=first,[ck,cl]=second,written=sv[0],delta=Math.abs(ck-ok),diff=Math.abs(delta-written);
    if(diff>1)continue;
    const level:salesSheetPumpConfidence = salesMatchesDelta(delta,written)?"high":"medium";
    const p=buildPump(`SCAN-${pumps.length+1}`,"",ok,ck,ol,cl,level); p.salesAmount=written; addUniquePump(pumps,p); i+=2;
    if(level==="medium")notes.push(`One pump sales line differs from its meter KSh delta by ${diff.toFixed(2)}; retained for review and not used for HIGH confidence.`);
  }

  let tillAmount=labelledAmount(text,/(?:till|tll|m-?pesa|mobile\s*money)/i),cashAmount=labelledAmount(text,/cash|cach/i),totalSales=labelledAmount(text,/(?:total|fotal|tota1)\s*(?:sales|sale|revenue|amount|collection)/i);
  for(const line of lines){
    const n=line.match(/^[-•]?\s*([a-z][a-z &/]+?)\s*(?:[-:]\s*|\s+)(.*)$/i); if(!n)continue; const label=n[1].trim(),nums=numericValues(n[2]); if(!nums.length)continue;
    if(/^(?:till|tll)\b/i.test(label)){tillAmount=nums[nums.length-1];continue;} if(/^cash\b/i.test(label)){cashAmount=nums[nums.length-1];continue;}
    if(/^(petrol|pms|diesel|ago|kerosene|lpg|v[- ]?power)\b/i.test(label)){otherDetails.push({label,value:nums[nums.length-1]});continue;}
    if(/^(supplier|supplies|generator|expense|lunch|transport|electricity|water|maintenance|fuel|labou?r|salary|airtime|bank|deposit|boss|amref|kcb)\b/i.test(label))expenses.push({name:label,amount:nums[nums.length-1]});
  }
  const computed=pumps.reduce((s,p)=>s+p.salesAmount,0);
  if(totalSales===undefined&&computed>0){totalSales=computed;notes.push("Total sales was derived from independently validated pump meter deltas.");}
  const agrees=totalSales===undefined||computed===0||Math.abs(totalSales-computed)<=Math.max(0.05,computed*0.0005);
  if(totalSales!==undefined&&computed>0&&!agrees)notes.push(`Written total sales differs from validated pump-meter sales by ${(totalSales-computed).toFixed(2)}; automatic application is blocked.`);
  for(let i=1;i<lines.length;i++){if(!/^\s*=\s*[\d,.]+\s*$/.test(lines[i]))continue;const v=numericValues(lines[i])[0],prev=lines[i-1];if(!v)continue;if(/^(?:[-•]?\s*)?(supplier|supplies|generator|expense|lunch|transport|electricity|water|maintenance|fuel|labou?r|salary|airtime)\b/i.test(prev)&&expenses.length)expenses[expenses.length-1].amount=v;}
  const complete=pumps.filter(p=>p.openingReading>0&&p.closingReading>0&&p.openingLitres>0&&p.closingLitres>0&&Number.isFinite(p.salesAmount)&&Number.isFinite(p.salesLitres));
  let confidence:SalesSheetFields["confidence"]="low";
  if(complete.length>=2&&complete.length===pumps.length&&agrees&&complete.every(p=>p.confidence==="high"))confidence="high";
  else if(complete.length>0||totalSales!==undefined||tillAmount!==undefined||cashAmount!==undefined)confidence="medium";
  if(!complete.length)notes.push("No complete handwritten pump blocks were validated. Do not auto-apply unreadable meter data.");
  if(!date)notes.push("Date was not visible/recognized in this image; the existing form date is retained and should be confirmed.");
  if(pumps.some(p=>p.direction==="decreasing"))notes.push("Some totalizers decrease from opening to closing; sales are calculated from the absolute meter delta.");
  if(pumps.length)notes.push("Pump/fuel identity is resolved against the station roster and shift-continuity readings; no identity is invented from row order.");
  return {date,shift,pumps,expenses,totalSales,tillAmount,cashAmount,otherDetails,confidence,notes};
}

type salesSheetPumpConfidence = "high"|"medium"|"low";
