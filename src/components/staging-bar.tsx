/** A red bar on every page of the staging copy, so it can never be mistaken for the live books (APP_ENV=staging). */
export function StagingBar() {
  if (process.env.APP_ENV !== "staging") return null;
  return (
    <div role="status" className="no-print sticky top-0 z-50 bg-red-600 px-3 py-1 text-center text-xs font-semibold tracking-wide text-white">
      STAGING — a test copy. Nothing done here affects the real books.
    </div>
  );
}
