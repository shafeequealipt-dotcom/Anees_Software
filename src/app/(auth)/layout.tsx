import { StagingBar } from "@/components/staging-bar";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
    <StagingBar />
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-brand-900 via-brand-700 to-accent-600 px-4 py-10">
      <div className="w-full max-w-md">{children}</div>
    </main>
    </>
  );
}
