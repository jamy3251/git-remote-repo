"use client";

import { useRouter } from "next/navigation";
import { useRunner } from "@/lib/runner/use-runner";
import { RunnerSettingsBar } from "@/components/runner-settings-bar";
import { ProductsView } from "@/components/products/products-view";

export function ProductsPage() {
  const runner = useRunner();
  const router = useRouter();
  return (
    <div className="space-y-3 pb-6">
      <div>
        <h1 className="text-xl font-semibold">프로덕트</h1>
        <p className="text-sm text-muted">러너 루트 아래에서 만든 것들을 한눈에: 살아 있는 것, 방치된 것, 손볼 것, 다음에 할 일.</p>
      </div>
      {runner.status !== "open" && <RunnerSettingsBar settings={runner.settings} status={runner.status} onSave={runner.updateSettings} onConnect={runner.connect} error={runner.lastError} />}
      {/* New tasks start from the control page, where the form lives. */}
      <ProductsView runner={runner} onDraft={(d) => router.push(`/control?cwd=${encodeURIComponent(d.cwd)}`)} />
    </div>
  );
}
