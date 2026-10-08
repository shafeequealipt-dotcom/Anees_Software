/** A product as it is written everywhere: its ID, then its name, on one line ("132 iphone bag"). */
export function ProductName({ code, name }: { code?: string | null; name: string }) {
  if (!code) return <>{name}</>;
  // A real space, not a margin, so copying the text or reading it aloud keeps the two apart.
  return (
    <>
      <span className="num font-normal text-faint">{code}</span> {name}
    </>
  );
}
