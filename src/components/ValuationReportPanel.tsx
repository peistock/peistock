import { useState, useEffect, useCallback } from 'react';
import { FileText, Loader2, X, Maximize2 } from 'lucide-react';
import { getAnalysisByCode } from '@/utils/researchApi';
import type { AnalysisByCodeResponse, AnalysisReport } from '@/utils/researchApi';

interface ValuationReportPanelProps {
  code: string;
}

const TYPE_LABELS: Record<string, string> = {
  growth_j_analysis: 'GROWTH-J 标准版',
  growth_j_analysis_v2: 'GROWTH-J 冲突声明版',
  growth_j_analysis_v1_2: 'GROWTH-J v1.2',
  james_framework_analysis: 'james 收息框架',
  comparison: '框架对比',
};

function getTypeLabel(type: string): string {
  for (const [key, label] of Object.entries(TYPE_LABELS)) {
    if (type.includes(key)) return label;
  }
  return type;
}

/** 全屏报告阅读器 */
function FullscreenReport({ report, onClose }: { report: AnalysisReport; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      {/* 内容面板 */}
      <div className="relative z-10 flex flex-col h-full bg-white">
        {/* 顶部工具栏 */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#f5f5f5] border-b border-[#e0e0e0] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-[#333] shrink-0" />
            <span className="text-sm font-medium text-[#1a1a1a] truncate">
              {report.title || getTypeLabel(report.type)}
            </span>
          </div>
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-xs text-[#666] hover:text-[#000] px-2 py-1 rounded hover:bg-[#e0e0e0] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
            关闭
          </button>
        </div>
        {/* 报告内容 */}
        <div className="flex-1 overflow-auto">
          {report.content_type === 'html' ? (
            <iframe
              srcDoc={report.content}
              className="w-full h-full border-0"
              title={report.title}
              sandbox="allow-same-origin"
            />
          ) : (
            <div className="max-w-4xl mx-auto p-8">
              <pre className="text-[14px] text-[#333] leading-relaxed whitespace-pre-wrap font-mono">
                {report.content}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ValuationReportPanel({ code }: ValuationReportPanelProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AnalysisByCodeResponse | null>(null);
  const [fullscreenReport, setFullscreenReport] = useState<AnalysisReport | null>(null);

  const loadData = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    try {
      const resp = await getAnalysisByCode(code);
      setData(resp);
    } catch (e) {
      console.error('加载估值报告失败', e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    if (!data && !loading) {
      loadData();
    }
  }, [code]);

  const hasReports = data && data.count > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2 text-[#8B949E] text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        加载报告中...
      </div>
    );
  }

  if (!hasReports) {
    return (
      <div className="text-center py-6 text-[#8B949E] text-sm">
        <p>该股票暂无估值分析报告</p>
        <p className="text-xs mt-1 text-[#484F58]">
          在本地运行 GROWTH-J 或 james 框架分析后，通过 deploy.sh 同步到服务器即可查看
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {data!.reports.map((report) => (
          <button
            key={report.filename}
            onClick={() => setFullscreenReport(report)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-[#30363D]/60 bg-[#0D1117] hover:bg-[#161B22] transition-colors text-left"
          >
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-3.5 h-3.5 text-[#58A6FF] shrink-0" />
              <span className="text-[13px] text-[#C9D1D9] truncate">
                {report.title || getTypeLabel(report.type)}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] text-[#484F58]">
                {new Date(report.updated_at).toLocaleDateString('zh-CN')}
              </span>
              <Maximize2 className="w-3 h-3 text-[#484F58]" />
            </div>
          </button>
        ))}
      </div>

      {fullscreenReport && (
        <FullscreenReport
          report={fullscreenReport}
          onClose={() => setFullscreenReport(null)}
        />
      )}
    </>
  );
}
