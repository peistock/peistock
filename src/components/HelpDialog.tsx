import { BookOpen, Code2, Copy, Check, AlertTriangle, TrendingUp, TrendingDown, Activity, GitCommit, BarChart3, Zap, Target } from 'lucide-react';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface HelpDialogProps {
  defaultTab?: 'overview' | 'indicators' | 'formula';
  children?: React.ReactNode;
}

// 代码块组件
const CodeBlock = ({ code, label }: { code: string; label?: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const highlightCode = (line: string) => {
    if (line.trim().startsWith('{') && line.trim().endsWith('}')) {
      return <span className="text-[#8B949E]">{line}</span>;
    }
    const parts = line.split(/(:=|:|;,|CROSS|MA|EMA|SUMBARS|AND|OR|COLOR|LINETHICK)/);
    return parts.map((part, i) => {
      if ([':=', ':', ';', ','].includes(part)) return <span key={i} className="text-[#C9D1D9]">{part}</span>;
      if (['SUMBARS', 'MA', 'EMA', 'CROSS', 'AND', 'OR'].includes(part)) return <span key={i} className="text-[#D2A8FF]">{part}</span>;
      if (part.startsWith('COLOR') || part.startsWith('LINETHICK')) return <span key={i} className="text-[#E3B341]">{part}</span>;
      if (['VOL', 'CAPITAL', 'C', 'DD', 'MAHS', 'EMAHS'].includes(part)) return <span key={i} className="text-[#79C0FF]">{part}</span>;
      if (/^\d+$/.test(part)) return <span key={i} className="text-[#79C0FF]">{part}</span>;
      return <span key={i} className="text-[#C9D1D9]">{part}</span>;
    });
  };

  return (
    <div className="bg-[#0D1117] rounded-lg border border-[#30363D] overflow-hidden">
      {label && (
        <div className="flex items-center justify-between px-3 py-2 bg-[#161B22] border-b border-[#30363D]">
          <span className="text-xs text-[#8B949E]">{label}</span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-[#8B949E] hover:text-white transition-colors"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      )}
      <div className="p-3 overflow-x-auto">
        <pre className="text-sm leading-relaxed" style={{ fontFamily: 'JetBrains Mono' }}>
          {code.split('\n').map((line, i) => (
            <div key={i} className="whitespace-pre">
              {highlightCode(line)}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
};

const SectionTitle = ({ icon: Icon, title, color }: { icon: any, title: string, color: string }) => (
  <h3 className={`text-base font-bold text-white mb-3 flex items-center gap-2 ${color}`}>
    <Icon className={`w-4 h-4 ${color}`} />
    {title}
  </h3>
);

const IndicatorCard = ({ name, desc, formula, color }: { name: string, desc: string, formula?: string, color: string }) => (
  <div className="p-3 bg-[#0D1117] rounded-lg border border-[#30363D] hover:border-[#30363D]/80 transition-colors">
    <div className="flex items-center gap-2 mb-1">
      <span className={`font-bold ${color}`}>{name}</span>
    </div>
    <p className="text-xs text-[#8B949E] mb-1">{desc}</p>
    {formula && <p className="text-xs text-[#6E7681] font-mono">{formula}</p>}
  </div>
);

const HelpDialog = ({ defaultTab = 'overview', children }: HelpDialogProps) => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {children || <button className="text-sm text-[#8B949E] hover:text-white transition-colors">帮助</button>}
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-auto bg-[#161B22] border-[#30363D] text-[#C9D1D9] p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-[#30363D]">
          <DialogTitle className="text-xl font-bold text-white" style={{ fontFamily: 'JetBrains Mono' }}>
            Peter量价均线交易系统 - 完整使用手册
          </DialogTitle>
        </DialogHeader>
        
        <div className="px-6 py-4">
          <Tabs defaultValue={defaultTab}>
            <TabsList className="grid w-full grid-cols-3 bg-[#0D1117] border border-[#30363D] mb-4">
              <TabsTrigger value="overview" className="flex items-center gap-2 data-[state=active]:bg-[#FF3435] data-[state=active]:text-white">
                <BookOpen className="w-4 h-4" />
                系统概述
              </TabsTrigger>
              <TabsTrigger value="indicators" className="flex items-center gap-2 data-[state=active]:bg-[#FF3435] data-[state=active]:text-white">
                <Activity className="w-4 h-4" />
                指标详解
              </TabsTrigger>
              <TabsTrigger value="formula" className="flex items-center gap-2 data-[state=active]:bg-[#FF3435] data-[state=active]:text-white">
                <Code2 className="w-4 h-4" />
                公式参考
              </TabsTrigger>
            </TabsList>
            
            {/* 系统概述 */}
            <TabsContent value="overview" className="space-y-6">
              {/* 系统简介 */}
              <section>
                <SectionTitle icon={Target} title="系统设计理念" color="text-[#FF3435]" />
                <div className="bg-[#0D1117] rounded-lg border border-[#30363D] p-4">
                  <p className="text-sm text-[#C9D1D9] leading-relaxed mb-3">
                    <strong className="text-white">Peter量价均线交易系统</strong>是基于"成交量与换手成本关系"的多周期量化交易框架。
                  </p>
                  <p className="text-sm text-[#8B949E] leading-relaxed mb-3">
                    传统均线系统只看价格，而本系统的核心是<span className="text-[#FF3435]">换手成本(MAHS)</span>——
                    基于实际成交量加权计算的市场平均持仓成本，反映真实的资金沉淀位置。
                  </p>
                  <div className="grid grid-cols-4 gap-2 mt-4">
                    <div className="text-center p-2 bg-[#161B22] rounded">
                      <div className="text-[#FF3435] font-bold text-lg">价值锚定</div>
                      <div className="text-xs text-[#8B949E]">换手成本</div>
                    </div>
                    <div className="text-center p-2 bg-[#161B22] rounded">
                      <div className="text-[#E3B341] font-bold text-lg">动能转折</div>
                      <div className="text-xs text-[#8B949E]">成本差</div>
                    </div>
                    <div className="text-center p-2 bg-[#161B22] rounded">
                      <div className="text-[#79C0FF] font-bold text-lg">偏离度量</div>
                      <div className="text-xs text-[#8B949E]">乖离率</div>
                    </div>
                    <div className="text-center p-2 bg-[#161B22] rounded">
                      <div className="text-[#03B172] font-bold text-lg">趋势定位</div>
                      <div className="text-xs text-[#8B949E]">多周期共振</div>
                    </div>
                  </div>
                </div>
              </section>

              {/* 市场支持 */}
              <section>
                <SectionTitle icon={BarChart3} title="支持市场" color="text-[#03B172]" />
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-4 bg-[#0D1117] rounded-lg border border-[#30363D]">
                    <div className="text-[#FF3435] font-bold text-sm mb-2">上海A股</div>
                    <div className="text-xs text-[#8B949E] mb-1">6位数字代码</div>
                    <div className="text-xs text-[#C9D1D9] font-mono">600519, 601318</div>
                    <div className="text-xs text-[#8B949E] mt-2">600/601/603/688开头</div>
                  </div>
                  <div className="p-4 bg-[#0D1117] rounded-lg border border-[#30363D]">
                    <div className="text-[#03B172] font-bold text-sm mb-2">深圳A股</div>
                    <div className="text-xs text-[#8B949E] mb-1">6位数字代码</div>
                    <div className="text-xs text-[#C9D1D9] font-mono">000001, 300750</div>
                    <div className="text-xs text-[#8B949E] mt-2">000/001/002/003/300开头</div>
                  </div>
                  <div className="p-4 bg-[#0D1117] rounded-lg border border-[#30363D]">
                    <div className="text-[#D2A8FF] font-bold text-sm mb-2">港股</div>
                    <div className="text-xs text-[#8B949E] mb-1">5位数字代码</div>
                    <div className="text-xs text-[#C9D1D9] font-mono">00700, 03690</div>
                    <div className="text-xs text-[#8B949E] mt-2">自动识别港股单位</div>
                  </div>
                </div>
              </section>

              {/* 三周期分析 */}
              <section>
                <SectionTitle icon={GitCommit} title="三周期共振分析" color="text-[#D2A8FF]" />
                <div className="space-y-3">
                  <div className="flex items-start gap-4 p-4 bg-[#0D1117] rounded-lg border border-[#30363D]">
                    <div className="w-16 h-16 rounded-lg bg-[#FF3435]/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-[#FF3435] text-lg font-bold">日K</span>
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-white mb-1">日线级别 - 战略层</div>
                      <p className="text-sm text-[#8B949E] mb-2">判断中长期趋势方向，确定主要操作方向（做多/做空/观望）</p>
                      <div className="flex gap-2 text-xs">
                        <span className="px-2 py-1 bg-[#161B22] rounded text-[#C9D1D9]">MAHS/EMAHS成本系统</span>
                        <span className="px-2 py-1 bg-[#161B22] rounded text-[#C9D1D9]">CRI风险指标</span>
                        <span className="px-2 py-1 bg-[#161B22] rounded text-[#C9D1D9]">BIAS225极值信号</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-4 p-4 bg-[#0D1117] rounded-lg border border-[#30363D]">
                    <div className="w-16 h-16 rounded-lg bg-[#D2A8FF]/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-[#D2A8FF] text-lg font-bold">周K</span>
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-white mb-1">周线级别 - 战略层</div>
                      <p className="text-sm text-[#8B949E] mb-2">判断长期趋势方向，识别主要支撑阻力位</p>
                      <div className="flex gap-2 text-xs">
                        <span className="px-2 py-1 bg-[#161B22] rounded text-[#C9D1D9]">长期趋势</span>
                        <span className="px-2 py-1 bg-[#161B22] rounded text-[#C9D1D9]">主要支撑阻力</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-4 p-4 bg-[#0D1117] rounded-lg border border-[#30363D]">
                    <div className="w-16 h-16 rounded-lg bg-[#03B172]/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-[#03B172] text-lg font-bold">15</span>
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-white mb-1">15分钟 - 执行层</div>
                      <p className="text-sm text-[#8B949E] mb-2">精确买卖点定位，止损止盈设置</p>
                      <div className="flex gap-2 text-xs">
                        <span className="px-2 py-1 bg-[#161B22] rounded text-[#C9D1D9]">短周期乖离率</span>
                        <span className="px-2 py-1 bg-[#161B22] rounded text-[#C9D1D9]">日内交易信号</span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* 买卖信号总览 */}
              <section>
                <SectionTitle icon={Zap} title="交易信号体系" color="text-[#E3B341]" />
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-[#FF3435]/5 rounded-lg border border-[#FF3435]/30">
                    <div className="flex items-center gap-2 text-[#FF3435] font-bold mb-3">
                      <TrendingUp className="w-4 h-4" />
                      买入信号组合
                    </div>
                    <ul className="space-y-2 text-sm text-[#C9D1D9]">
                      <li className="flex items-start gap-2">
                        <span className="text-[#FF3435]">1.</span>
                        <span><strong className="text-white">成本差上穿零轴</strong> - 短期资金成本超越长期，转强信号</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-[#FF3435]">2.</span>
                        <span><strong className="text-white">BIAS225历史极值低位</strong> - 股价偏离225均线达历史极端低位</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-[#FF3435]">3.</span>
                        <span><strong className="text-white">CRI恐慌状态</strong> - 综合风险&gt;40且负成本偏离，逆向时机</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-[#FF3435]">4.</span>
                        <span><strong className="text-white">价格贴近MAHS</strong> - 低于成本2%以内，安全边际高</span>
                      </li>
                    </ul>
                  </div>
                  <div className="p-4 bg-[#03B172]/5 rounded-lg border border-[#03B172]/30">
                    <div className="flex items-center gap-2 text-[#03B172] font-bold mb-3">
                      <TrendingDown className="w-4 h-4" />
                      卖出信号组合
                    </div>
                    <ul className="space-y-2 text-sm text-[#C9D1D9]">
                      <li className="flex items-start gap-2">
                        <span className="text-[#03B172]">1.</span>
                        <span><strong className="text-white">成本差下穿零轴</strong> - 短期资金成本低于长期，转弱信号</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-[#03B172]">2.</span>
                        <span><strong className="text-white">BIAS225历史极值高位</strong> - 股价偏离225均线达历史极端高位</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-[#03B172]">3.</span>
                        <span><strong className="text-white">价格远离MAHS</strong> - 高于成本8%以上，考虑止盈</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-[#03B172]">4.</span>
                        <span><strong className="text-white">多周期背离</strong> - 日线与15分钟趋势相反，减仓观望</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </section>
            </TabsContent>
            
            {/* 指标详解 */}
            <TabsContent value="indicators" className="space-y-6">
              {/* 核心成本指标 */}
              <section>
                <SectionTitle icon={GitCommit} title="核心成本指标" color="text-[#FF3435]" />
                <div className="grid grid-cols-1 gap-3">
                  <IndicatorCard 
                    name="DD (换手天数)" 
                    desc="从当前日期往前累计成交量达到流通股本所需的天数。DD越大说明筹码沉淀越稳定，DD越小说明换手率越高、筹码活跃"
                    formula="DD = SUMBARS(成交量, 流通股本)"
                    color="text-[#D2A8FF]"
                  />
                  <IndicatorCard 
                    name="MAHS (换手成本)" 
                    desc="基于DD周期的简单移动平均，反映市场真实的平均持仓成本。股价低于MAHS表示当前持有者平均亏损，高于则平均盈利"
                    formula="MAHS = MA(收盘价, DD)"
                    color="text-[#FF3435]"
                  />
                  <IndicatorCard 
                    name="EMAHS (指数换手成本)" 
                    desc="基于DD周期的指数移动平均，对近期价格给予更高权重，反映最新的资金成本变化"
                    formula="EMAHS = EMA(收盘价, DD)"
                    color="text-[#03B172]"
                  />
                  <IndicatorCard 
                    name="成本差" 
                    desc="EMAHS与MAHS的差值。上穿零轴表示短期成本超越长期成本，资金抢筹；下穿表示资金派发"
                    formula="成本差 = EMAHS - MAHS"
                    color="text-[#E3B341]"
                  />
                </div>
              </section>

              {/* CRI综合风险指标 */}
              <section>
                <SectionTitle icon={AlertTriangle} title="CRI 恐慌指标 v2.1" color="text-[#FF6B6B]" />
                <div className="bg-[#0D1117] rounded-lg border border-[#30363D] p-4">
                  <p className="text-sm text-[#C9D1D9] mb-2">
                    <strong className="text-[#FF6B6B]">CRI (Composite Risk Indicator) v2.1</strong> 
                    是<strong className="text-white">恐慌专用指标</strong>，0-100分制。与VIX不同，CRI只识别下跌恐慌，对上涨不敏感。
                  </p>
                  <div className="text-xs text-[#E3B341] mb-3 p-2 bg-[#E3B341]/10 rounded border border-[#E3B341]/30">
                    <strong>重大修正 v2.1：</strong>从"对称波动指标"改为"单向恐慌指标"。只惩罚负向偏离，上涨时指标保持低位。
                  </div>
                  
                  <div className="grid grid-cols-4 gap-2 mb-4">
                    <div className="text-center p-2 bg-[#161B22] rounded border border-[#FF6B6B]/30">
                      <div className="text-[#FF6B6B] font-bold text-sm">成本偏离</div>
                      <div className="text-xs text-[#8B949E]">只惩罚负偏离</div>
                      <div className="text-[10px] text-[#FF6B6B]">上涨时=0分</div>
                    </div>
                    <div className="text-center p-2 bg-[#161B22] rounded border border-[#E3B341]/30">
                      <div className="text-[#E3B341] font-bold text-sm">向下跳空</div>
                      <div className="text-xs text-[#8B949E]">只计算低开</div>
                      <div className="text-[10px] text-[#E3B341]">向上跳空忽略</div>
                    </div>
                    <div className="text-center p-2 bg-[#161B22] rounded border border-[#D2A8FF]/30">
                      <div className="text-[#D2A8FF] font-bold text-sm">趋势加权</div>
                      <div className="text-xs text-[#8B949E]">下跌+波动=恐慌</div>
                      <div className="text-[10px] text-[#D2A8FF]">上涨+波动忽略</div>
                    </div>
                    <div className="text-center p-2 bg-[#161B22] rounded border border-[#79C0FF]/30">
                      <div className="text-[#79C0FF] font-bold text-sm">百分位</div>
                      <div className="text-xs text-[#8B949E]">趋势敏感加权</div>
                      <div className="text-[10px] text-[#79C0FF]">下跌中权重更高</div>
                    </div>
                  </div>

                  <div className="text-xs text-[#8B949E] mb-2">指标行为特征：</div>
                  <div className="grid grid-cols-2 gap-2 text-center text-xs">
                    <div className="p-2 bg-[#FF3435]/20 rounded text-[#FF6B6B]">
                      <div className="font-bold">恐慌状态</div>
                      <div>CRI &gt; 40 且 价格低于MAHS</div>
                      <div className="text-[10px] mt-1">超跌+高波动 = 抄底时机</div>
                    </div>
                    <div className="p-2 bg-[#03B172]/20 rounded text-[#03B172]">
                      <div className="font-bold">非恐慌状态</div>
                      <div>CRI &lt; 40 或 价格高于MAHS</div>
                      <div className="text-[10px] mt-1">上涨/横盘时指标保持低位</div>
                    </div>
                  </div>
                </div>
              </section>

              {/* 贪婪情绪指标 */}
              <section>
                <SectionTitle icon={TrendingUp} title="GSI 贪婪情绪指标" color="text-[#03B172]" />
                <div className="bg-[#0D1117] rounded-lg border border-[#30363D] p-4">
                  <p className="text-sm text-[#C9D1D9] mb-2">
                    <strong className="text-[#03B172]">GSI (Greed Sentiment Indicator)</strong> 
                    是<strong className="text-white">贪婪专用指标</strong>，0-100分制。与CRI恐慌指标形成双向情绪识别体系。
                  </p>
                  <div className="text-xs text-[#03B172] mb-3 p-2 bg-[#03B172]/10 rounded border border-[#03B172]/30">
                    <strong>设计逻辑：</strong>贪婪与恐慌并非简单对称。贪婪因子独立构建，反映市场过度乐观的不同维度。
                  </div>
                  
                  <div className="grid grid-cols-5 gap-2 mb-4">
                    <div className="text-center p-2 bg-[#161B22] rounded border border-[#03B172]/30">
                      <div className="text-[#03B172] font-bold text-xs">正向成本偏离</div>
                      <div className="text-[10px] text-[#8B949E]">价格泡沫</div>
                      <div className="text-[10px] text-[#03B172]">权重30%</div>
                    </div>
                    <div className="text-center p-2 bg-[#161B22] rounded border border-[#E3B341]/30">
                      <div className="text-[#E3B341] font-bold text-xs">向上跳空</div>
                      <div className="text-[10px] text-[#8B949E]">追高情绪</div>
                      <div className="text-[10px] text-[#E3B341]">权重20%</div>
                    </div>
                    <div className="text-center p-2 bg-[#161B22] rounded border border-[#D2A8FF]/30">
                      <div className="text-[#D2A8FF] font-bold text-xs">贪婪型波动</div>
                      <div className="text-[10px] text-[#8B949E]">上涨中波动放大</div>
                      <div className="text-[10px] text-[#D2A8FF]">权重15%</div>
                    </div>
                    <div className="text-center p-2 bg-[#161B22] rounded border border-[#79C0FF]/30">
                      <div className="text-[#79C0FF] font-bold text-xs">乖离率极端</div>
                      <div className="text-[10px] text-[#8B949E]">历史高位</div>
                      <div className="text-[10px] text-[#79C0FF]">权重20%</div>
                    </div>
                    <div className="text-center p-2 bg-[#161B22] rounded border border-[#FF6B6B]/30">
                      <div className="text-[#FF6B6B] font-bold text-xs">成交量激增</div>
                      <div className="text-[10px] text-[#8B949E]">情绪亢奋</div>
                      <div className="text-[10px] text-[#FF6B6B]">权重15%</div>
                    </div>
                  </div>

                  <div className="text-xs text-[#8B949E] mb-2">情绪指数 = 贪婪 - 恐慌 (-100 ~ +100)：</div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2 bg-[#03B172]/20 rounded text-[#03B172]">
                      <div className="font-bold">正值 &gt; 0</div>
                      <div>贪婪主导</div>
                      <div className="text-[10px] mt-1">市场过度乐观</div>
                    </div>
                    <div className="p-2 bg-[#8B949E]/20 rounded text-[#8B949E]">
                      <div className="font-bold">接近 0</div>
                      <div>情绪平衡</div>
                      <div className="text-[10px] mt-1">正常波动区间</div>
                    </div>
                    <div className="p-2 bg-[#FF6B6B]/20 rounded text-[#FF6B6B]">
                      <div className="font-bold">负值 &lt; 0</div>
                      <div>恐慌主导</div>
                      <div className="text-[10px] mt-1">市场过度悲观</div>
                    </div>
                  </div>
                </div>
              </section>

              {/* 乖离率 */}
              <section>
                <SectionTitle icon={Activity} title="乖离率 BIAS" color="text-[#79C0FF]" />
                <div className="bg-[#0D1117] rounded-lg border border-[#30363D] p-4">
                  <p className="text-sm text-[#C9D1D9] mb-3">
                    乖离率反映股价与均线的偏离程度，用于判断超买超卖。本系统采用<strong className="text-white">BIAS225历史极值</strong>作为核心信号：
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="text-[#FF3435] font-bold">≤10%分位</span>
                      <span className="text-[#C9D1D9]">历史极端低位 → <strong className="text-[#FF3435]">强烈买入</strong></span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[#E3B341] font-bold">10-20%分位</span>
                      <span className="text-[#C9D1D9]">低于历史80% → 买入提示</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[#8B949E] font-bold">20-80%分位</span>
                      <span className="text-[#C9D1D9]">正常区间</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[#E3B341] font-bold">80-90%分位</span>
                      <span className="text-[#C9D1D9]">高于历史80% → 卖出提示</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[#03B172] font-bold">≥90%分位</span>
                      <span className="text-[#C9D1D9]">历史极端高位 → <strong className="text-[#03B172]">强烈卖出</strong></span>
                    </div>
                  </div>
                </div>
              </section>

              {/* 均线系统 */}
              <section>
                <SectionTitle icon={BarChart3} title="均线系统" color="text-[#D2A8FF]" />
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-[#0D1117] rounded-lg border border-[#30363D]">
                    <div className="text-white font-bold mb-2">日线/周线均线</div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between"><span className="text-[#FFFFFF]">MA5</span><span className="text-[#8B949E]">短线趋势</span></div>
                      <div className="flex justify-between"><span className="text-[#E3B341]">MA20</span><span className="text-[#8B949E]">月线级别</span></div>
                      <div className="flex justify-between"><span className="text-[#D2A8FF]">MA99</span><span className="text-[#8B949E]">季线级别</span></div>
                      <div className="flex justify-between"><span className="text-[#03B172]">MA128</span><span className="text-[#8B949E]">半年线</span></div>
                      <div className="flex justify-between"><span className="text-[#FF3435]">MA225</span><span className="text-[#8B949E]">年线/牛熊分界</span></div>
                    </div>
                  </div>
                  <div className="p-3 bg-[#0D1117] rounded-lg border border-[#30363D]">
                    <div className="text-white font-bold mb-2">15分钟均线</div>
                    <div className="space-y-1 text-xs text-[#8B949E]">
                      <div>MA5 → 75分钟趋势</div>
                      <div>MA20 → 5小时趋势</div>
                      <div>MA99 → 约25小时</div>
                      <div>MA128 → 约32小时</div>
                      <div>MA225 → 约56小时</div>
                    </div>
                  </div>
                </div>
              </section>
            </TabsContent>
            
            {/* 公式参考 */}
            <TabsContent value="formula" className="space-y-5">
              <section>
                <SectionTitle icon={Code2} title="换手成本核心公式" color="text-[#FF3435]" />
                <CodeBlock 
                  label="通达信公式 - 换手成本指标"
                  code={`{换手天数计算}
DD := SUMBARS(VOL, CAPITAL);

{换手成本线}
MAHS: MA(C, DD), COLORRED, LINETHICK2;
EMAHS: EMA(C, DD), COLORGREEN, LINETHICK1;

{成本差 - 短期强弱转折}
成本差: EMAHS - MAHS, COLORSTICK;
零轴: 0, COLORGRAY;

{成本偏离度}
偏离度: (C - EMAHS) / EMAHS * 100, COLORYELLOW;`}
                />
              </section>
              
              <section>
                <SectionTitle icon={Code2} title="CRI综合风险指标公式 v2.1 - 恐慌专用" color="text-[#FF6B6B]" />
                <CodeBlock 
                  label="Python实现参考"
                  code={`# CRI v2.1 - 重大修正：从"对称波动"改为"单向恐慌"
# 核心变化：只惩罚下跌，上涨不再贡献恐慌分

# 1. 成本偏离 - 只惩罚负偏离（恐慌专用）
basis_pct = (price - mahs) / mahs * 100
is_below_mahs = basis_pct < 0

if is_below_mahs:
    # 价格低于均线，超跌越严重恐慌分越高
    basis_score = min(abs(basis_pct) * 100 * 8, 100)
else:
    # 价格上涨时 basis_score = 0，不贡献恐慌分
    basis_score = 0

# 2. 跳跃风险 - 只惩罚向下跳空
down_gap = max(0, log(prev_close / open))  # 只有低开才算
avg_down_gap = mean(down_gap, 20)
std_down_gap = std(down_gap, 20)
safe_std = max(std_down_gap, 0.0005)
jump_z = (down_gap - max(avg_down_gap, 0.001)) / safe_std
jump_score = clip(jump_z * 15 + 50, 0, 100)

# 3. 波动率曲线 - 结合趋势方向
vol_short = yz_volatility(window=5)
vol_long = yz_volatility(window=60)
curve_slope = (vol_short - vol_long) / max(vol_long, 1)
is_below_ma20 = close < ma20

if is_below_ma20 and curve_slope > 0:
    # 下跌趋势 + 波动放大 = 恐慌确认
    curve_score = min(curve_slope * 60, 100)
elif not is_below_ma20 and curve_slope > 0:
    # 上涨趋势 + 波动放大 = 可能是健康上涨
    curve_score = min(curve_slope * 20, 40)
else:
    curve_score = max(curve_slope * 10 + 20, 0)

# 4. 波动率百分位 - 趋势加权
percentile = percentile_rank(vol_current, vol_history) * 100
trend_adjusted_pct = percentile if is_below_ma20 else percentile * 0.5

# 合成CRI - 恐慌专用权重（提高单向指标权重）
cri = max(
    basis_score * 0.95,                              # 成本偏离权重最高
    jump_score * 0.9,                                # 向下跳空
    curve_score * (0.85 if is_below_ma20 else 0.4)   # 波动曲线趋势敏感
) + trend_adjusted_pct * 0.1

# 状态判定 - 只有真正恐慌才标记
if cri > 40 and is_below_mahs:   cri_state = 'panic'
elif cri < 15 and not is_below_mahs:   cri_state = 'complacent'
else:                                   cri_state = 'normal'`}
                />
              </section>

              <section>
                <SectionTitle icon={Code2} title="GSI贪婪情绪指标公式" color="text-[#03B172]" />
                <CodeBlock 
                  label="Python实现参考"
                  code={`# GSI (Greed Sentiment Indicator) - 贪婪情绪指标
# 贪婪与恐慌并非简单对称，独立构建贪婪子因子

# 1. 正向成本偏离（价格泡沫）- 权重30%
pos_basis = max(0, (price - mahs) / mahs * 100)
pos_history = [max(0, (c - m) / m * 100) for c, m in zip(closes, mahs)]
pos_threshold = percentile(pos_history[-120:], 80)
pos_extreme = percentile(pos_history[-120:], 95)

if pos_basis <= pos_threshold:
    score1 = 0
elif pos_basis >= pos_extreme:
    score1 = 100
else:
    score1 = (pos_basis - pos_threshold) / (pos_extreme - pos_threshold) * 100

# 2. 向上跳空强度 - 权重20%
up_gap = max(0, log(open / prev_close))
avg_up = mean(up_gaps[-20:])
std_up = std(up_gaps[-20:]) + 0.0001
z_up = (up_gap - avg_up) / std_up
score2 = clip(z_up * 15 + 50, 0, 100)

# 3. 贪婪型波动（上涨中波动放大）- 权重15%
is_up_trend = close > ma20
if is_up_trend:
    curve_slope = (vol_short - vol_long) / max(vol_long, 1)
    score3 = clip(curve_slope * 40, 0, 100)
else:
    score3 = 0

# 4. 乖离率历史极端高位 - 权重20%
pct_bias225 = percentile_rank(bias225, bias225_history[-120:]) * 100
score4 = clip((pct_bias225 - 80) / (95 - 80) * 100, 0, 100)

# 5. 成交量激增 - 权重15%
vol_ratio = volume / ma(volume, 20)
vol_threshold = percentile(vol_ratios[-120:], 90)

if vol_ratio <= 1.2:
    score5 = 0
elif vol_ratio >= vol_threshold:
    score5 = 100
else:
    score5 = (vol_ratio - 1.2) / (vol_threshold - 1.2) * 100

# 合成贪婪总分
greedy = score1 * 0.30 + score2 * 0.20 + score3 * 0.15 + score4 * 0.20 + score5 * 0.15

# 贪婪状态判定
if greedy >= 70 and price > mahs:
    greedy_state = 'greedy'
else:
    greedy_state = 'normal'

# 综合情绪指数 = 贪婪 - 恐慌 (-100 ~ +100)
sentiment = clip(greedy - cri, -100, 100)`}
                />
              </section>
              
              <section>
                <SectionTitle icon={Code2} title="Yang-Zhang波动率" color="text-[#E3B341]" />
                <CodeBlock 
                  label="YZ Volatility计算"
                  code={`{YZ波动率同时考虑隔夜跳空和日内波动}

{组成部分}
overnight_return = log(Open_t / Close_t-1)
intraday_return = log(Close_t / Open_t)

{Rogers-Satchell估计}
log_HC = log(High / Close)
log_HO = log(High / Open)
log_LC = log(Low / Close)
log_LO = log(Low / Open)
RS_est = log_HC * log_HO + log_LC * log_LO

{YZ方差}
variance_YZ = var(overnight) + 0.34 * var(intraday) + 0.66 * mean(RS_est)

{年化波动率}
YZ_Vol = sqrt(variance_YZ) * sqrt(252) * 100`}
                />
              </section>
              
              <section>
                <SectionTitle icon={Code2} title="均线系统公式" color="text-[#D2A8FF]" />
                <div className="space-y-3">
                  <CodeBlock 
                    label="15分钟均线（短线）"
                    code={`MA5_15: MA(C, 5), COLORWHITE;
MA20_15: MA(C, 20), COLORYELLOW;
MA99_15: MA(C, 99), COLORMAGENTA;
MA128_15: MA(C, 128), COLORGREEN;
MA225_15: MA(C, 225), COLORRED;`}
                  />
                  <CodeBlock 
                    label="周线均线（长线）"
                    code={`MA5_W: MA(C#WEEK, 5), LINETHICK2, COLORWHITE;
MA20_W: MA(C#WEEK, 20), LINETHICK2, COLORYELLOW;
MA99_W: MA(C#WEEK, 99), LINETHICK2, COLORMAGENTA;
MA128_W: MA(C#WEEK, 128), LINETHICK2, COLORGREEN;
MA225_W: MA(C#WEEK, 225), LINETHICK2, COLORRED;`}
                  />
                </div>
              </section>
              
              <section>
                <SectionTitle icon={Code2} title="乖离率公式" color="text-[#79C0FF]" />
                <CodeBlock 
                  label="多周期乖离率"
                  code={`{乖离率 = (收盘价 - 均线) / 均线 * 100}

{15分钟乖离率}
BIAS5 := (C - MA(C, 5)) / MA(C, 5) * 100;
BIAS20 := (C - MA(C, 20)) / MA(C, 20) * 100;
BIAS99 := (C - MA(C, 99)) / MA(C, 99) * 100;
BIAS128 := (C - MA(C, 128)) / MA(C, 128) * 100;
BIAS225 := (C - MA(C, 225)) / MA(C, 225) * 100;

{周线乖离率}
BIAS20_W := (C#WEEK - MA(C#WEEK, 20)) / MA(C#WEEK, 20) * 100;`}
                />
              </section>
              
              <section>
                <SectionTitle icon={Code2} title="选股公式" color="text-[#03B172]" />
                <CodeBlock 
                  label="双周期成本共振买点"
                  code={`{基础计算}
DD := SUMBARS(VOL, CAPITAL);
MAHS := MA(C, DD);
EMAHS := EMA(C, DD);
成本差 := EMAHS - MAHS;

{乖离率}
BIAS20 := (C - MA(C, 20)) / MA(C, 20) * 100;

{买入条件}
条件1 := CROSS(成本差, 0);           {成本差上穿零轴}
条件2 := C < MAHS * 1.03;             {价格低于成本3%}
条件3 := BIAS20 < -5;                 {BIAS20超跌}
条件4 := CRI > 40 AND (C - MAHS)/MAHS < -0.05;  {CRI高风险且负成本偏离}

选股: 条件1 AND 条件2 AND 条件3 AND 条件4;`}
                />
              </section>

              <section>
                <SectionTitle icon={Code2} title="系统架构" color="text-[#E3B341]" />
                <div className="p-4 bg-gradient-to-r from-[#FF3435]/10 via-[#D2A8FF]/10 to-[#03B172]/10 rounded-lg border border-[#30363D]">
                  <div className="grid grid-cols-4 gap-4 text-center text-sm">
                    <div>
                      <div className="text-[#FF3435] font-bold mb-1">价值锚定</div>
                      <div className="text-xs text-[#8B949E]">MAHS/EMAHS<br/>换手成本</div>
                    </div>
                    <div>
                      <div className="text-[#E3B341] font-bold mb-1">动能转折</div>
                      <div className="text-xs text-[#8B949E]">成本差<br/>CRI</div>
                    </div>
                    <div>
                      <div className="text-[#79C0FF] font-bold mb-1">偏离度量</div>
                      <div className="text-xs text-[#8B949E]">BIAS225<br/>历史极值</div>
                    </div>
                    <div>
                      <div className="text-[#03B172] font-bold mb-1">趋势定位</div>
                      <div className="text-xs text-[#8B949E]">日/120/15<br/>三周期共振</div>
                    </div>
                  </div>
                </div>
              </section>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default HelpDialog;
