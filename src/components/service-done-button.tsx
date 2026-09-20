"use client";

import { useRouter } from "next/navigation";
import { markServiceDoneAction } from "@/app/actions/admin";
import { Button } from "./ui";

export function ServiceDoneButton({ id }: { id: number }) {
  const router = useRouter();
  return (
    <Button
      size="sm"
      onClick={async () => {
        await markServiceDoneAction(id);
        router.refresh();
      }}
    >
      Done
    </Button>
  );
}
