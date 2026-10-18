import { EncyclopediaScreen } from "./components/EncyclopediaScreen";
import { EquipmentScreen } from "./components/EquipmentScreen";
import { FishBagScreen } from "./components/FishBagScreen";
import { LakePanel } from "./components/LakePanel";
import { LakeStage } from "./components/LakeStage";
import { NoticeArea } from "./components/Notices";
import { SettingsScreen } from "./components/SettingsScreen";
import { TabBar } from "./components/TabBar";
import { Toast } from "./components/Toast";
import { getPendingCount } from "./game/state";
import { useGame, useWideLayout } from "./game/useGame";

export default function App() {
  const { state, actions, reducedMotion, getRoundElapsed } = useGame();
  const wide = useWideLayout();
  const { save, tab } = state;
  // Phones show the lake only on its own tab; at >= 900px it stays in the left column.
  const showStage = wide || tab === "lake";

  return (
    <div className="app" data-tab={tab} data-wide={wide}>
      <div className="layout">
        {showStage && (
          <LakeStage
            state={state}
            reducedMotion={reducedMotion}
            onTap={actions.tap}
            getRoundElapsed={getRoundElapsed}
            onToggleMusic={() => actions.updateSettings({ musicEnabled: !save.settings.musicEnabled })}
          />
        )}
        <main className="side">
          <NoticeArea notices={state.notices} onDismiss={actions.dismissNotice} onGoBag={() => actions.setTab("bag")} />
          {tab === "lake" && <LakePanel log={state.log} />}
          {tab === "bag" && (
            <FishBagScreen
              save={save}
              onSellPending={actions.sellPending}
              onKeepPending={actions.keepPending}
              onSellInventory={actions.sellInventory}
              onSellAllPending={actions.sellAllPending}
              onSellAllInventory={actions.sellAllInventory}
            />
          )}
          {tab === "equipment" && <EquipmentScreen save={save} onUpgrade={actions.upgrade} />}
          {tab === "encyclopedia" && <EncyclopediaScreen save={save} />}
          {tab === "settings" && (
            <SettingsScreen
              save={save}
              onSettings={actions.updateSettings}
              onImport={actions.importSave}
              onReset={actions.reset}
            />
          )}
        </main>
      </div>

      <TabBar tab={tab} onChange={actions.setTab} pendingCount={getPendingCount(save)} />
      <Toast toast={state.toast} onDone={actions.dismissToast} />
    </div>
  );
}
