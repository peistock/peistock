import { BookOpen, AlertTriangle, TrendingUp, TrendingDown, Activity, GitCommit, BarChart3, Zap, Target } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface HelpDialogProps {
  defaultTab?: 'overview' | 'indicators' | 'guide';
  children?: React.ReactNode;
}



const SectionTitle = ({ icon: Icon, title, color }: { icon: any, title: string, color: string }) => (
  <h3 className={`text-base font-bold text-white mb-3 flex items-center gap-2 ${color}`}>
    <Icon className={`w-4 h-4 ${color}`} />
    {title}
  </h3>
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
              <TabsTrigger value="guide" className="flex items-center gap-2 data-[state=active]:bg-[#FF3435] data-[state=active]:text-white">
                <Target className="w-4 h-4" />
                使用指南
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

              {/* 交易思路 */}
              <section>
                <SectionTitle icon={Zap} title="交易思路" color="text-[#E3B341]" />
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-[#FF3435]/5 rounded-lg border border-[#FF3435]/30">
                    <div className="flex items-center gap-2 text-[#FF3435] font-bold mb-3">
                      <TrendingUp className="w-4 h-4" />
                      关注机会
                    </div>
                    <p className="text-sm text-[#C9D1D9]">
                      当市场情绪极端悲观、价格大幅偏离成本且处于历史低位时，关注逆向布局机会。
                    </p>
                  </div>
                  <div className="p-4 bg-[#03B172]/5 rounded-lg border border-[#03B172]/30">
                    <div className="flex items-center gap-2 text-[#03B172] font-bold mb-3">
                      <TrendingDown className="w-4 h-4" />
                      风险控制
                    </div>
                    <p className="text-sm text-[#C9D1D9]">
                      当市场情绪过度乐观、价格大幅偏离成本且处于历史高位时，注意风险控制。
                    </p>
                  </div>
                </div>
              </section>
            </TabsContent>
            
            {/* 指标详解 */}
            <TabsContent value="indicators" className="space-y-6">
              {/* 核心成本指标 */}
              <section>
                <SectionTitle icon={GitCommit} title="核心成本指标" color="text-[#FF3435]" />
                <div className="space-y-3">
                  <div className="p-3 bg-[#0D1117] rounded-lg border border-[#30363D]">
                    <div className="font-bold text-white mb-1">换手成本 (MAHS/EMAHS)</div>
                    <p className="text-xs text-[#8B949E]">基于实际成交量计算的市场平均持仓成本，反映真实资金沉淀位置。价格围绕成本波动，偏离过大时存在回归动力。</p>
                  </div>
                  <div className="p-3 bg-[#0D1117] rounded-lg border border-[#30363D]">
                    <div className="font-bold text-white mb-1">成本差</div>
                    <p className="text-xs text-[#8B949E]">短期成本与长期成本的偏离程度，用于判断资金进出动向。</p>
                  </div>
                </div>
              </section>

              {/* CRI恐慌指标 */}
              <section>
                <SectionTitle icon={AlertTriangle} title="CRI 恐慌指标" color="text-[#FF6B6B]" />
                <div className="bg-[#0D1117] rounded-lg border border-[#30363D] p-4">
                  <p className="text-sm text-[#C9D1D9] mb-3">
                    综合多维度市场情绪，识别恐慌状态。评分0-100，高分表示市场情绪极端悲观。
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-center text-xs">
                    <div className="p-2 bg-[#FF3435]/20 rounded text-[#FF6B6B]">
                      <div className="font-bold">高位+下跌</div>
                      <div className="text-[10px]">恐慌状态，关注机会</div>
                    </div>
                    <div className="p-2 bg-[#03B172]/20 rounded text-[#03B172]">
                      <div className="font-bold">低位+上涨</div>
                      <div className="text-[10px]">情绪平稳或乐观</div>
                    </div>
                  </div>
                </div>
              </section>

              {/* 贪婪指标 */}
              <section>
                <SectionTitle icon={TrendingUp} title="贪婪情绪指标" color="text-[#03B172]" />
                <div className="bg-[#0D1117] rounded-lg border border-[#30363D] p-4">
                  <p className="text-sm text-[#C9D1D9] mb-3">
                    识别市场过度乐观状态，与恐慌指标形成双向情绪监测。
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2 bg-[#03B172]/20 rounded text-[#03B172]">
                      <div className="font-bold">正值</div>
                      <div>贪婪主导</div>
                    </div>
                    <div className="p-2 bg-[#8B949E]/20 rounded text-[#8B949E]">
                      <div className="font-bold">接近0</div>
                      <div>情绪平衡</div>
                    </div>
                    <div className="p-2 bg-[#FF6B6B]/20 rounded text-[#FF6B6B]">
                      <div className="font-bold">负值</div>
                      <div>恐慌主导</div>
                    </div>
                  </div>
                </div>
              </section>

              {/* 乖离率 */}
              <section>
                <SectionTitle icon={Activity} title="乖离率" color="text-[#79C0FF]" />
                <div className="bg-[#0D1117] rounded-lg border border-[#30363D] p-4">
                  <p className="text-sm text-[#C9D1D9] mb-3">
                    反映价格与均线的偏离程度，极端偏离时存在回归动力。
                  </p>
                  <div className="flex justify-between text-xs">
                    <span className="text-[#FF3435]">极端低位 → 关注买入</span>
                    <span className="text-[#8B949E]">正常区间</span>
                    <span className="text-[#03B172]">极端高位 → 关注卖出</span>
                  </div>
                </div>
              </section>

              {/* 均线系统 */}
              <section>
                <SectionTitle icon={BarChart3} title="均线系统" color="text-[#D2A8FF]" />
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-[#0D1117] rounded-lg border border-[#30363D]">
                    <div className="text-white font-bold mb-2">日线/周线</div>
                    <p className="text-xs text-[#8B949E]">判断中长期趋势方向，识别主要支撑阻力位</p>
                  </div>
                  <div className="p-3 bg-[#0D1117] rounded-lg border border-[#30363D]">
                    <div className="text-white font-bold mb-2">15分钟</div>
                    <p className="text-xs text-[#8B949E]">短周期买卖点定位，辅助日内交易决策</p>
                  </div>
                </div>
              </section>
            </TabsContent>
            
            {/* 使用说明 */}
            <TabsContent value="guide" className="space-y-5">
              <section>
                <SectionTitle icon={BookOpen} title="快速入门" color="text-[#FF3435]" />
                <div className="bg-[#0D1117] rounded-lg border border-[#30363D] p-4">
                  <p className="text-sm text-[#C9D1D9] leading-relaxed mb-3">
                    本系统基于换手成本与量价关系，识别市场极端情绪状态。
                  </p>
                  <div className="space-y-2 text-sm text-[#8B949E]">
                    <p>1. 输入股票代码搜索（如 600519、000001）</p>
                    <p>2. 系统自动计算换手成本 MAHS/EMAHS</p>
                    <p>3. 观察 CRI 恐慌指数和贪婪指数</p>
                    <p>4. 结合三周期（日K/周K/15分钟）综合判断</p>
                  </div>
                </div>
              </section>
              
              <section>
                <SectionTitle icon={AlertTriangle} title="指标说明" color="text-[#E3B341]" />
                <div className="space-y-3">
                  <div className="p-3 bg-[#0D1117] rounded-lg border border-[#30363D]">
                    <div className="font-bold text-white mb-1">MAHS / EMAHS</div>
                    <p className="text-xs text-[#8B949E]">基于实际成交量的市场平均持仓成本，反映真实资金沉淀位置</p>
                  </div>
                  <div className="p-3 bg-[#0D1117] rounded-lg border border-[#30363D]">
                    <div className="font-bold text-white mb-1">CRI 恐慌指数</div>
                    <p className="text-xs text-[#8B949E]">综合成本偏离、跳空风险、波动率等多因子，识别恐慌状态</p>
                  </div>
                  <div className="p-3 bg-[#0D1117] rounded-lg border border-[#30363D]">
                    <div className="font-bold text-white mb-1">贪婪指数</div>
                    <p className="text-xs text-[#8B949E]">识别市场过度乐观状态，与恐慌指数形成双向情绪监测</p>
                  </div>
                </div>
              </section>
              
              <section>
                <SectionTitle icon={Target} title="风险提示" color="text-[#FF6B6B]" />
                <div className="p-4 bg-[#FF3435]/5 rounded-lg border border-[#FF3435]/20">
                  <p className="text-sm text-[#C9D1D9]">
                    本工具仅供学习研究，不构成投资建议。股市有风险，投资需谨慎。
                  </p>
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
