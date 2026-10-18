import type { IconName } from "../art";
import type { Tab } from "../game/state";
import { Icon } from "./Pixel";

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "lake", label: "湖畔", icon: "lake" },
  { id: "bag", label: "魚包", icon: "backpack" },
  { id: "equipment", label: "裝備", icon: "rod" },
  { id: "encyclopedia", label: "圖鑑", icon: "book" },
  { id: "settings", label: "設定", icon: "gear" }
];

export function TabBar({ tab, onChange, pendingCount }: { tab: Tab; onChange: (tab: Tab) => void; pendingCount: number }) {
  return (
    <nav className="tabbar" aria-label="主選單">
      {TABS.map((item) => (
        <button
          key={item.id}
          className={`tab ${tab === item.id ? "active" : ""}`}
          aria-current={tab === item.id ? "page" : undefined}
          aria-label={item.id === "bag" && pendingCount > 0 ? `${item.label}，待處理 ${pendingCount} 隻` : undefined}
          onClick={() => onChange(item.id)}
        >
          <span className="tab-icon">
            <Icon name={item.icon} px={2} />
            {item.id === "bag" && pendingCount > 0 && <span className="badge" aria-hidden="true">{pendingCount > 99 ? "99+" : pendingCount}</span>}
          </span>
          <span className="tab-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
