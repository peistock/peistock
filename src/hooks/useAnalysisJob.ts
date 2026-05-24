import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { submitAnalysisJob, getTaskStatus } from '../utils/researchApi';

interface BackgroundJob {
  taskId: string;
  code: string;
  name: string;
  status: 'queued' | 'running' | 'completed' | 'error';
  progress: string;
  decision?: string;
  conviction?: number;
  date?: string;
  reportPreview?: string;
  error?: string;
  notified?: boolean;
}

export function useAnalysisJob(stockSymbol: string | undefined, stockName: string | undefined) {
  const [backgroundJobs, setBackgroundJobs] = useState<Record<string, BackgroundJob>>({});
  const [showReport, setShowReport] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const pollIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const currentJob = useMemo(() => {
    if (!stockSymbol) return null;
    return backgroundJobs[stockSymbol] || null;
  }, [backgroundJobs, stockSymbol]);

  const analyzing = currentJob?.status === 'queued' || currentJob?.status === 'running' || false;
  const analyzeProgress = currentJob?.progress || '';
  const aiDecision = currentJob?.decision
    ? { decision: currentJob.decision, conviction: currentJob.conviction || 50, date: currentJob.date || '' }
    : null;
  const aiReport = currentJob?.reportPreview || null;

  const handleAnalyze = useCallback(async () => {
    if (!stockSymbol || !stockName) return;
    const code = stockSymbol;
    const name = stockName;

    const existing = backgroundJobs[code];
    if (existing?.status === 'queued' || existing?.status === 'running') {
      return;
    }

    setShowReport(false);
    setAnalyzeError(null);

    try {
      const job = await submitAnalysisJob(code, 'B');
      if (!job.task_id) {
        throw new Error('未返回任务 ID');
      }

      if (job.status === 'completed' && job.result?.report_preview) {
        const preview = job.result.report_preview;
        const decisionMatch = preview.match(/##\s*决策[（(]Decision[）)]\s*\n?\s*(LONG|SHORT|NEUTRAL)/i);
        let decision = 'neutral';
        if (decisionMatch) {
          const d = decisionMatch[1].toLowerCase();
          if (d === 'long') decision = 'long';
          else if (d === 'short') decision = 'short';
        }
        setBackgroundJobs(prev => ({
          ...prev,
          [code]: {
            taskId: job.task_id,
            code,
            name,
            status: 'completed',
            progress: '分析完成',
            decision,
            conviction: job.result?.conviction || 50,
            date: job.result?.date || '',
            reportPreview: preview,
          },
        }));
        return;
      }

      setBackgroundJobs(prev => ({
        ...prev,
        [code]: {
          taskId: job.task_id,
          code,
          name,
          status: 'queued',
          progress: '提交分析任务...',
        },
      }));
    } catch (e: any) {
      console.error('AI分析失败', e);
      setAnalyzeError(e.message || 'AI分析失败');
    }
  }, [stockSymbol, stockName, backgroundJobs]);

  // 后台轮询
  useEffect(() => {
    const runningJobs = Object.values(backgroundJobs).filter(
      job => (job.status === 'queued' || job.status === 'running') && !pollIntervalsRef.current[job.code]
    );

    for (const job of runningJobs) {
      const checkStatus = async () => {
        try {
          const status = await getTaskStatus(job.taskId);

          setBackgroundJobs(prev => {
            const current = prev[job.code];
            if (!current) return prev;
            const updated = { ...prev };

            if (status.status === 'completed') {
              const preview = status.result?.report_preview || '';
              const decisionMatch = preview.match(/##\s*决策[（(]Decision[）)]\s*\n?\s*(LONG|SHORT|NEUTRAL)/i);
              let decision = 'neutral';
              if (decisionMatch) {
                const d = decisionMatch[1].toLowerCase();
                if (d === 'long') decision = 'long';
                else if (d === 'short') decision = 'short';
              }
              updated[job.code] = {
                ...current,
                status: 'completed',
                progress: '分析完成',
                decision,
                conviction: status.result?.conviction || 50,
                date: status.result?.date || '',
                reportPreview: preview,
              };
            } else if (status.status === 'error') {
              updated[job.code] = {
                ...current,
                status: 'error',
                progress: status.detail || '分析失败',
                error: status.detail || '未知错误',
              };
            } else {
              updated[job.code] = {
                ...current,
                status: status.status as 'queued' | 'running',
                progress: status.progress || '分析中...',
              };
            }
            return updated;
          });
        } catch (e: any) {
          console.error('轮询失败', e);
          setBackgroundJobs(prev => {
            const current = prev[job.code];
            if (!current) return prev;
            return {
              ...prev,
              [job.code]: {
                ...current,
                status: 'error',
                progress: e.message || '轮询失败',
                error: e.message || '轮询失败',
              },
            };
          });
        }
      };

      checkStatus();
      pollIntervalsRef.current[job.code] = setInterval(checkStatus, 5000);
    }

    Object.entries(pollIntervalsRef.current).forEach(([code, interval]) => {
      const job = backgroundJobs[code];
      if (!job || (job.status !== 'queued' && job.status !== 'running')) {
        clearInterval(interval);
        delete pollIntervalsRef.current[code];
      }
    });

    return () => {
      Object.entries(pollIntervalsRef.current).forEach(([code, interval]) => {
        clearInterval(interval);
        delete pollIntervalsRef.current[code];
      });
    };
  }, [backgroundJobs]);

  return {
    backgroundJobs,
    setBackgroundJobs,
    showReport,
    setShowReport,
    currentJob,
    analyzing,
    analyzeProgress,
    aiDecision,
    aiReport,
    analyzeError,
    clearAnalyzeError: useCallback(() => setAnalyzeError(null), []),
    handleAnalyze,
  };
}
