import {loadSimRows} from "./sim-data-loader";
import {exportSimTniNationalFromTemplate} from "./sim-excel-export";
export async function buildSimTniExcel(file:File,period:string){const x=await loadSimRows(period);const r=await exportSimTniNationalFromTemplate(file,period,x.rows);return x.period?r:{...r,notices:["Periode "+period+" belum memiliki sim_records di Supabase.",...r.notices]};}
