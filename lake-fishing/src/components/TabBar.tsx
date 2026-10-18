import type { IconName } from "../art";
import type { Tab } from "../game/state";
import { Icon } from "./Pixel";

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "lake", label: "湖畔", icon: "lake" },
  { id: "backpack", label: "背包", icon: "backpack" },
  { id: "upgrade", label: "升級", icon: "rod" },
  { id: "encyclopedia", label: "圖鑑", icon: "book" },
  { id: "settings", label: "設定", icon: "gear" }
];

export function TabBar({ tab, onChange, backpackCount }: { tab: Tab; onChange: (tab: Tab) => void; backpackCount: number }) {
  return (
    <nav className="tabbar" aria-label="主選單">
      {TABS.map((item) => (
        <button
          key={item.id}
          className={`tab ${tab === item.id ? "active" : ""}`}
          aria-current={tab === item.id ? "page" : undefined}
          onClick={() => onChange(item.id)}
        >
          <span className="tab-icon">
            <Icon name={item.icon} px={2} />
            {item.id === "backpack" && backpackCount > 0 && <span className="badge" aria-hidden="true">{backpackCount > 99 ? "99+" : backpackCount}</span>}
          </span>
          <span className="tab-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
