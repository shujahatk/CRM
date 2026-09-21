export function Brand({ light = false }: { light?: boolean }) {
  return <div className={`flex items-center gap-3 ${light ? "text-white" : "text-[#153e34]"}`}>
    <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-xl bg-[#c0e5d5] text-sm font-extrabold text-[#153e34]">80/20</span>
    <span className="text-xl font-semibold tracking-tight">80/20 <span className="font-normal opacity-70">CRM</span></span>
  </div>;
}
