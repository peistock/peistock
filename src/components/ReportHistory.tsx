import { useState } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ReportHistoryItem } from '@/utils/researchApi';

interface ReportHistoryProps {
  data: ReportHistoryItem[];
}

function normalizeReport(report: any): { summary: string; full: string } {
  if (typeof report === 'string') {
    return { summary: report, full: report };
  }
  if (report && typeof report === 'object') {
    return {
      summary: report.summary || '',
      full: report.full || report.summary || '',
    };
  }
  return { summary: '', full: '' };
}
const ROLE_LABELS: Record<string, string> = {
  bull: 'Bull',
  bear: 'Bear',
  preemption: 'Preemption',
  chair_debate: 'Chair裁决',
};

const ROLE_COLORS: Record<string, string> = {
  bull: 'text-[#03B172]',
  bear: 'text-[#FF3435]',
  preemption: 'text-[#D2A8FF]',
  chair_debate: 'text-[#E3B341]',
};

function DecisionBadge({ decision, conviction }: { decision: string; conviction: number }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    long: { bg: 'bg-[#03B172]/20', text: 'text-[#03B172]', label: '做多' },
    short: { bg: 'bg-[#FF3435]/20', text: 'text-[#FF3435]', label: '做空' },
    neutral: { bg: 'bg-[#6B7280]/20', text: 'text-[#6B7280]', label: '观望' },
  };
  const c = config[decision.toLowerCase()] || config.neutral;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
      {conviction > 0 && ` · ${Math.round(conviction)}%`}
    </span>
  );
}

function ReportCell({ summary, full, role }: { summary: string; full: string; role: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!summary && !full) {
    return <span className="text-[#30363D] text-xs">—</span>;
  }
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="cursor-pointer select-none"
            onClick={() => setExpanded(!expanded)}
          >
            <p className={`text-[13px] text-[#C9D1D9] leading-relaxed ${expanded ? '' : 'line-clamp-6'}`}>
              {summary || full.slice(0, 150) + "..."}
            </p>
            {!expanded && full.length > 150 && (
              <span className="text-[10px] text-[#58A6FF] mt-1 block">点击展开</span>
            )}
            {expanded && (
              <>
                <div className="mt-2 pt-2 border-t border-[#30363D]/40">
                  <div className={`font-semibold mb-1 ${ROLE_COLORS[role]}`}>{ROLE_LABELS[role]} 完整报告</div>
                  <div className="text-[13px] text-[#C9D1D9] leading-relaxed whitespace-pre-wrap">{full}</div>
                </div>
                <span className="text-[10px] text-[#58A6FF] mt-1 block">点击收起</span>
              </>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="max-w-lg bg-[#0D1117] border border-[#30363D] text-[#C9D1D9] text-[13px] leading-relaxed p-3 max-h-[400px] overflow-y-auto hidden md:block"
        >
          <div className={`font-semibold mb-2 ${ROLE_COLORS[role]}`}>{ROLE_LABELS[role]}</div>
          <div className="whitespace-pre-wrap">{full}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function ReportHistory({ data }: ReportHistoryProps) {
  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-[#8B949E] text-sm">
        暂无历史分析数据
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[#30363D]">
            <th className="px-3 py-2 text-[11px] font-medium text-[#8B949E] whitespace-nowrap">
              日期
            </th>
            <th className="px-3 py-2 text-[11px] font-medium text-[#8B949E] min-w-[180px]">
              Bull观点
            </th>
            <th className="px-3 py-2 text-[11px] font-medium text-[#8B949E] min-w-[180px]">
              Bear观点
            </th>
            <th className="px-3 py-2 text-[11px] font-medium text-[#8B949E] min-w-[180px]">
              Preemption
            </th>
            <th className="px-3 py-2 text-[11px] font-medium text-[#8B949E] min-w-[180px]">
              Chair裁决
            </th>
            <th className="px-3 py-2 text-[11px] font-medium text-[#8B949E] whitespace-nowrap">
              决策
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
              <tr
                key={item.date}
                className="border-b border-[#30363D]/60 hover:bg-[#0D1117]/50 transition-colors"
              >
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <div className="text-[13px] text-[#C9D1D9] font-mono">{item.date}</div>
                  {item.price != null && (
                    <div className="text-[11px] text-[#8B949E] mt-0.5">
                      ¥{item.price.toFixed(2)}
                      {item.change_pct != null && (
                        <span
                          className={
                            item.change_pct >= 0 ? 'text-[#03B172]' : 'text-[#FF3435]'
                          }
                        >
                          {' '}{item.change_pct >= 0 ? '+' : ''}
                          {item.change_pct.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 align-top">
                  <ReportCell {...normalizeReport(item.reports.bull)} role="bull" />
                </td>
                <td className="px-3 py-2.5 align-top">
                  <ReportCell {...normalizeReport(item.reports.bear)} role="bear" />
                </td>
                <td className="px-3 py-2.5 align-top">
                  <ReportCell {...normalizeReport(item.reports.preemption)} role="preemption" />
                </td>
                <td className="px-3 py-2.5 align-top">
                  <ReportCell {...normalizeReport(item.reports.chair_debate)} role="chair_debate" />
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap align-top">
                  <DecisionBadge decision={item.decision} conviction={item.conviction} />
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
