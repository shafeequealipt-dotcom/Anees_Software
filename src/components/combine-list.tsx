"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Button, Empty, Panel } from "./ui";

interface Group {
  partyId: number;
  partyName: string;
  docs: { id: number; label: string; date: string; totalPaise: number }[];
}

export function CombineList({ target, groups }: { target: string; groups: Group[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<number[]>([]);
  if (groups.length === 0) return <Empty title="Nothing waiting to be billed">Orders, quotations and challans that have not been turned into a bill yet will appear here.</Empty>;
  const partyOfPicked = groups.find((g) => g.docs.some((d) => picked.includes(d.id)))?.partyId;

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <Panel
          key={g.partyId}
          title={g.partyName}
          actions={
            partyOfPicked === g.partyId ? (
              <Button variant="primary" size="sm" onClick={() => router.push(`${target}/new?from=${picked.join(",")}`)}>
                Make one bill from {picked.length} selected
              </Button>
            ) : undefined
          }
          padded={false}
        >
          <ul className="divide-y divide-line">
            {g.docs.map((d) => {
              const disabled = partyOfPicked !== undefined && partyOfPicked !== g.partyId;
              return (
                <li key={d.id}>
                  <label className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-ground/60 ${disabled ? "opacity-40" : ""}`}>
                    <input
                      type="checkbox"
                      className="size-4 accent-brand-600"
                      disabled={disabled}
                      checked={picked.includes(d.id)}
                      onChange={(e) => setPicked((p) => (e.target.checked ? [...p, d.id] : p.filter((x) => x !== d.id)))}
                    />
                    <span className="font-medium">{d.label}</span>
                    <span className="text-muted">{formatDate(d.date)}</span>
                    <span className="num ml-auto">{formatMoney(d.totalPaise)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Panel>
      ))}
    </div>
  );
}
