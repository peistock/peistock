import ETFMarketFlowPanel from './ETFMarketFlowPanel';
import ETFSectorFlowPanel from './ETFSectorFlowPanel';

export default function SectorView() {
  return (
    <div className="space-y-6">
      <ETFMarketFlowPanel />
      <ETFSectorFlowPanel />
    </div>
  );
}
