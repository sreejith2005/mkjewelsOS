/** Read a complete, deterministically ordered history under the caller's RLS. */
export async function readAllCrmRows<T>(readPage: (from: number,to: number)=>PromiseLike<{data:T[] | null;error?:unknown}>) {
  const data:T[]=[];
  const pageSize=500;
  for(let from=0;;from+=pageSize){
    const page=await readPage(from,from+pageSize-1);
    if(page.error) throw page.error;
    const rows=page.data ?? [];
    data.push(...rows);
    if(rows.length<pageSize) return {data,error:null};
  }
}
