"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { restoreVoucherAction } from "@/app/actions/vouchers";
import { Button } from "./ui";

export function RestoreButton({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await restoreVoucherAction(id);
          setBusy(false);
          if (!res.ok) return setError(res.error);
          router.refresh();
        }}
      >
        {busy ? "Restoring…" : "Restore"}
      </Button>
      {error && <span className="max-w-56 text-right text-xs text-bad">{error}</span>}
    </span>
  );
}
