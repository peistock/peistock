// 用户关注股票列表
// 格式: { code: 股票代码, name: 股票名称, market: 市场(SH/SZ/HK/US) }

export const WATCHLIST = [
  // 图1
  { code: "601117", name: "中国化学", market: "SH", category: "能源化工" },
  { code: "07747", name: "南方两倍做多三星", market: "HK", category: "ETF/其他" },
  { code: "SKM", name: "韩国SK电信", market: "US", category: "通信石油" },
  { code: "603986", name: "兆易创新", market: "SH", star: true, category: "半导体电子" },
  { code: "600346", name: "恒力石化", market: "SH", category: "能源化工" },
  { code: "300469", name: "信息发展", market: "SZ", category: "ETF/其他" },
  { code: "159731", name: "石化ETF", market: "SZ", category: "ETF/其他" },
  { code: "600160", name: "巨化股份", market: "SH", category: "能源化工" },
  { code: "002493", name: "荣盛石化", market: "SZ", category: "能源化工" },
  { code: "600426", name: "华鲁恒升", market: "SH", category: "能源化工" },
  { code: "600989", name: "宝丰能源", market: "SH", star: true, category: "能源化工" },
  { code: "01548", name: "金斯瑞生物科技", market: "HK", category: "医药生物" },
  { code: "002575", name: "群兴玩具", market: "SZ", category: "ETF/其他" },
  { code: "600251", name: "冠农股份", market: "SH", category: "消费食饮" },
  
  // 图2
  { code: "520990", name: "港股央企红利ETF景", market: "SH", category: "ETF/其他" },
  { code: "01030", name: "新城发展", market: "HK", category: "ETF/其他" },
  { code: "03933", name: "联邦制药", market: "HK", category: "医药生物" },
  { code: "603345", name: "安井食品", market: "SH", category: "消费食饮" },
  { code: "600863", name: "华能蒙电", market: "SH", category: "电力公用" },
  { code: "001286", name: "陕西能源", market: "SZ", category: "电力公用" },
  { code: "000783", name: "长江证券", market: "SZ", star: true, category: "金融保险" },
  { code: "06198", name: "青岛港", market: "HK", category: "电力公用" },
  { code: "000426", name: "兴业银锡", market: "SZ", category: "有色矿业" },
  { code: "002128", name: "电投能源", market: "SZ", star: true, category: "煤炭" },
  { code: "600096", name: "云天化", market: "SH", category: "能源化工" },
  { code: "03877", name: "中国船舶租赁", market: "HK", category: "金融保险" },
  { code: "02510", name: "德翔海运", market: "HK", star: true, category: "电力公用" },
  
  // 图3
  { code: "00297", name: "中化化肥", market: "HK", category: "能源化工" },
  { code: "601155", name: "新城控股", market: "SH", category: "ETF/其他" },
  { code: "600089", name: "特变电工", market: "SH", category: "新能源" },
  { code: "600570", name: "恒生电子", market: "SH", category: "ETF/其他" },
  { code: "603605", name: "珀莱雅", market: "SH", category: "消费食饮" },
  { code: "06963", name: "阳光保险", market: "HK", category: "金融保险" },
  { code: "00966", name: "中国太平", market: "HK", category: "金融保险" },
  { code: "02601", name: "中国太保", market: "HK", category: "金融保险" },
  { code: "02328", name: "中国财险", market: "HK", star: true, category: "金融保险" },
  { code: "01339", name: "中国人民保险集团", market: "HK", category: "金融保险" },
  { code: "01508", name: "中国再保险", market: "HK", category: "金融保险" },
  { code: "02888", name: "渣打集团", market: "HK", category: "金融保险" },
  
  // 图4
  { code: "01723", name: "恒月控股", market: "HK", category: "ETF/其他" },
  { code: "00388", name: "香港交易所", market: "HK", category: "金融保险" },
  { code: "01428", name: "耀才证券金融", market: "HK", category: "金融保险" },
  { code: "03316", name: "滨江服务", market: "HK", category: "ETF/其他" },
  { code: "09688", name: "再鼎医药", market: "HK", category: "医药生物" },
  { code: "09926", name: "康方生物", market: "HK", category: "医药生物" },
  { code: "02666", name: "环球医疗", market: "HK", category: "医药生物" },
  { code: "00902", name: "华能国际电力股份", market: "HK", category: "电力公用" },
  { code: "01071", name: "华电国际电力股份", market: "HK", category: "电力公用" },
  { code: "02648", name: "安井食品", market: "HK", category: "消费食饮" },
  { code: "02097", name: "蜜雪集团", market: "HK", category: "消费食饮" },
  { code: "09992", name: "泡泡玛特", market: "HK", star: true, category: "消费食饮" },
  { code: "09898", name: "微博-SW", market: "HK", category: "ETF/其他" },
  
  // 图5
  { code: "02386", name: "中石化炼化工程", market: "HK", category: "能源化工" },
  { code: "00525", name: "广深铁路股份", market: "HK", category: "电力公用" },
  { code: "00316", name: "东方海外国际", market: "HK", category: "电力公用" },
  { code: "01919", name: "中远海控", market: "HK", category: "电力公用" },
  { code: "00941", name: "中国移动", market: "HK", star: true, category: "通信石油" },
  { code: "00728", name: "中国电信", market: "HK", category: "通信石油" },
  { code: "00857", name: "中国石油股份", market: "HK", category: "通信石油" },
  { code: "00883", name: "中国海洋石油", market: "HK", category: "通信石油" },
  { code: "01787", name: "山东黄金", market: "HK", star: true, category: "有色矿业" },
  { code: "02259", name: "紫金黄金国际", market: "HK", category: "有色矿业" },
  { code: "02899", name: "紫金矿业", market: "HK", star: true, category: "有色矿业" },
  { code: "02099", name: "中国黄金国际", market: "HK", star: true, category: "有色矿业" },
  { code: "01258", name: "中国有色矿业", market: "HK", category: "有色矿业" },
  
  // 图6
  { code: "01208", name: "五矿资源", market: "HK", category: "有色矿业" },
  { code: "01378", name: "中国宏桥", market: "HK", category: "有色矿业" },
  { code: "02600", name: "中国铝业", market: "HK", category: "有色矿业" },
  { code: "02020", name: "安踏体育", market: "HK", category: "消费食饮" },
  { code: "00003", name: "香港中华煤气", market: "HK", category: "电力公用" },
  { code: "02382", name: "舜宇光学科技", market: "HK", category: "半导体电子" },
  { code: "02018", name: "瑞声科技", market: "HK", category: "半导体电子" },
  { code: "01810", name: "小米集团-W", market: "HK", category: "ETF/其他" },
  { code: "00981", name: "中芯国际", market: "HK", category: "半导体电子" },
  { code: "03931", name: "中创新航", market: "HK", category: "新能源" },
  { code: "09660", name: "地平线机器人-W", market: "HK", category: "汽车机械" },
  { code: "00175", name: "吉利汽车", market: "HK", category: "汽车机械" },
  { code: "02333", name: "长城汽车", market: "HK", category: "汽车机械" },
  
  // 图7
  { code: "002048", name: "宁波华翔", market: "SZ", category: "汽车机械" },
  { code: "003021", name: "兆威机电", market: "SZ", category: "汽车机械" },
  { code: "002472", name: "双环传动", market: "SZ", category: "汽车机械" },
  { code: "603501", name: "豪威集团", market: "SH", star: true, category: "半导体电子" },
  { code: "600498", name: "烽火通信", market: "SH", category: "通信石油" },
  { code: "002281", name: "光迅科技", market: "SZ", category: "半导体电子" },
  { code: "300394", name: "天孚通信", market: "SZ", category: "半导体电子" },
  { code: "300502", name: "新易盛", market: "SZ", category: "半导体电子" },
  { code: "300308", name: "中际旭创", market: "SZ", category: "半导体电子" },
  { code: "002463", name: "沪电股份", market: "SZ", category: "半导体电子" },
  { code: "300476", name: "胜宏科技", market: "SZ", category: "半导体电子" },
  { code: "688041", name: "海光信息", market: "SH", category: "半导体电子" },
  { code: "002475", name: "立讯精密", market: "SZ", category: "半导体电子" },
  
  // 图8
  { code: "605488", name: "福莱新材", market: "SH", category: "能源化工" },
  { code: "600489", name: "中金黄金", market: "SH", category: "有色矿业" },
  { code: "601899", name: "紫金矿业", market: "SH", star: true, category: "有色矿业" },
  { code: "000408", name: "藏格矿业", market: "SZ", category: "有色矿业" },
  { code: "000630", name: "铜陵有色", market: "SZ", category: "有色矿业" },
  { code: "600459", name: "贵研铂业", market: "SH", category: "有色矿业" },
  { code: "000933", name: "神火股份", market: "SZ", category: "有色矿业" },
  { code: "000807", name: "云铝股份", market: "SZ", star: true, category: "有色矿业" },
  { code: "000792", name: "盐湖股份", market: "SZ", category: "有色矿业" },
  { code: "603993", name: "洛阳钼业", market: "SH", category: "有色矿业" },
  { code: "000893", name: "亚钾国际", market: "SZ", category: "能源化工" },
  { code: "600900", name: "长江电力", market: "SH", star: true, category: "电力公用" },
  { code: "600886", name: "国投电力", market: "SH", category: "电力公用" },
  
  // 图9
  { code: "600795", name: "国电电力", market: "SH", category: "电力公用" },
  { code: "600406", name: "国电南瑞", market: "SH", star: true, category: "电力公用" },
  { code: "000429", name: "粤高速A", market: "SZ", category: "电力公用" },
  { code: "600548", name: "深高速", market: "SH", category: "电力公用" },
  { code: "601127", name: "赛力斯", market: "SH", category: "汽车机械" },
  { code: "300750", name: "宁德时代", market: "SZ", category: "新能源" },
  { code: "300014", name: "亿纬锂能", market: "SZ", category: "新能源" },
  { code: "603100", name: "川仪股份", market: "SH", category: "汽车机械" },
  { code: "603298", name: "杭叉集团", market: "SH", category: "汽车机械" },
  { code: "159985", name: "豆粕ETF", market: "SZ", category: "ETF/其他" },
  { code: "600583", name: "海油工程", market: "SH", category: "通信石油" },
  { code: "600026", name: "中远海能", market: "SH", category: "电力公用" },
  
  // 图10
  { code: "600009", name: "上海机场", market: "SH", category: "电力公用" },
  { code: "000921", name: "海信家电", market: "SZ", category: "消费食饮" },
  { code: "600690", name: "海尔智家", market: "SH", category: "消费食饮" },
  { code: "000651", name: "格力电器", market: "SZ", category: "消费食饮" },
  { code: "000333", name: "美的集团", market: "SZ", category: "消费食饮" },
  { code: "300378", name: "鼎捷数智", market: "SZ", category: "ETF/其他" },
  { code: "300896", name: "爱美客", market: "SZ", category: "医药生物" },
  { code: "002299", name: "圣农发展", market: "SZ", category: "消费食饮" },
  { code: "159850", name: "恒生国企ETF", market: "SZ", category: "ETF/其他" },
  { code: "600703", name: "三安光电", market: "SH", category: "半导体电子" },
  { code: "300765", name: "新诺威", market: "SZ", category: "医药生物" },
  { code: "601012", name: "隆基绿能", market: "SH", category: "新能源" },
  { code: "000001", name: "平安银行", market: "SZ", category: "金融保险" },
  
  // 图11
  { code: "002415", name: "海康威视", market: "SZ", category: "半导体电子" },
  { code: "600276", name: "恒瑞医药", market: "SH", category: "医药生物" },
  { code: "600309", name: "万华化学", market: "SH", category: "能源化工" },
  { code: "600436", name: "片仔癀", market: "SH", category: "医药生物" },
  { code: "600031", name: "三一重工", market: "SH", category: "汽车机械" },
  { code: "600519", name: "贵州茅台", market: "SH", category: "消费食饮" },
  { code: "000858", name: "五粮液", market: "SZ", category: "消费食饮" },
  { code: "600809", name: "山西汾酒", market: "SH", category: "消费食饮" },
  { code: "601318", name: "中国平安", market: "SH", category: "金融保险" },
  { code: "002110", name: "三钢闽光", market: "SZ", category: "有色矿业" },
  { code: "600011", name: "华能国际", market: "SH", category: "电力公用" },
  { code: "600256", name: "广汇能源", market: "SH", category: "能源化工" },
  { code: "601101", name: "昊华能源", market: "SH", category: "煤炭" },
  
  // 图12
  { code: "601088", name: "中国神华", market: "SH", category: "煤炭" },
  { code: "600188", name: "兖矿能源", market: "SH", category: "煤炭" },
  { code: "601225", name: "陕西煤业", market: "SH", category: "煤炭" },
  { code: "601666", name: "平煤股份", market: "SH", category: "煤炭" },
  { code: "600985", name: "淮北矿业", market: "SH", category: "煤炭" },
  { code: "600971", name: "恒源煤电", market: "SH", category: "煤炭" },
  { code: "601108", name: "财通证券", market: "SH", category: "金融保险" },
  { code: "300059", name: "东方财富", market: "SZ", category: "金融保险" },
  { code: "601919", name: "中远海控", market: "SH", category: "电力公用" },
  { code: "000803", name: "山高环能", market: "SZ", category: "ETF/其他" },
  { code: "603822", name: "ST嘉澳", market: "SH", category: "能源化工" },
  { code: "688196", name: "卓越新能", market: "SH", star: true, category: "能源化工" },
];

// 去重函数
export function getUniqueWatchlist() {
  const seen = new Set();
  return WATCHLIST.filter(item => {
    if (seen.has(item.code)) {
      return false;
    }
    seen.add(item.code);
    return true;
  });
}

// 按行业分组（用于股票池展示）
export const WATCHLIST_GROUPS = (() => {
  const groups = new Map<string, typeof WATCHLIST>();
  for (const stock of WATCHLIST) {
    const cat = (stock as any).category || '其他';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(stock);
  }
  // 按数量降序排列
  return Array.from(groups.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([label, stocks]) => ({ label, stocks }));
})();

// 获取股票总数
export const TOTAL_STOCKS = getUniqueWatchlist().length;
