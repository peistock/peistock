import MarketBreadthPanel from './MarketBreadthPanel';
import ETFMarketFlowPanel from './ETFMarketFlowPanel';
import ETFSectorFlowPanel from './ETFSectorFlowPanel';
import ETFFundFlowDetailTable from './ETFFundFlowDetailTable';

export default function SectorView() {
  return (
    <div className="space-y-6">
      <MarketBreadthPanel />
      <ETFMarketFlowPanel />
      <ETFSectorFlowPanel />
      <ETFFundFlowDetailTable />
    </div>
  );
}
