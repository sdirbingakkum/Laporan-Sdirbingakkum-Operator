import {supabase} from "./supabase";
const T=["A","BI","BII","BII_KHUSUS","C"] as const;
export async function loadSimRows(period:string){
 if(!supabase)throw Error("Koneksi database belum tersedia.");const y=+period.slice(0,4),m=+period.slice(5,7);
 const p=await supabase.from("report_periods").select("id").eq("period_type","MONTH").eq("report_year",y).eq("report_month",m).maybeSingle();if(p.error)throw p.error;
 const [ps,ts,rs]=await Promise.all([supabase.from("pomdams").select("id,code").eq("active",true).order("display_order"),supabase.from("sim_types").select("id,code").eq("active",true).order("display_order"),p.data?supabase.from("sim_records").select("pomdam_id,sim_type_id,value,data_status").eq("period_id",p.data.id):Promise.resolve({data:[],error:null})]);
 if(ps.error)throw ps.error;if(ts.error)throw ts.error;if(rs.error)throw rs.error;const tm=new Map((ts.data??[]).map(x=>[x.id,x.code])),pm=new Map<string,Record<string,number|null>>();
 for(const r of rs.data??[]){const t=tm.get(r.sim_type_id);if(!T.includes(t as any))continue;let v=pm.get(r.pomdam_id);if(!v){v={};pm.set(r.pomdam_id,v);}v[t!]=r.data_status==="VALID"&&r.value!==null?Number(r.value):null;}
 return {period:!!p.data,rows:(ps.data??[]).map(x=>({code:x.code,values:Object.fromEntries(T.map(t=>[t,pm.get(x.id)?.[t]??null]))}))};
}
