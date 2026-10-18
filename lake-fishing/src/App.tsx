import { BackpackScreen } from "./components/BackpackScreen";
import { BitePrompt } from "./components/BitePrompt";
import { EncyclopediaScreen } from "./components/EncyclopediaScreen";
import { CatchResultDialog, CorruptDialog, OfflineDialog } from "./components/GameDialogs";
import { LakeScreen } from "./components/LakeScreen";
import { Minigame } from "./components/Minigame";
import { SettingsScreen } from "./components/SettingsScreen";
import { TabBar } from "./components/TabBar";
import { Toast } from "./components/Toast";
import { UpgradeScreen } from "./components/UpgradeScreen";
import { useGame } from "./game/useGame";

export default function App() {
  const { state, actions, reducedMotion } = useGame();
  const { save, mode, tab } = state;
  const dialog = state.dialogs[0];

  return (
    <div className="app" data-tab={tab}>
      <main className="main">
        {tab === "lake" && (
          <LakeScreen
            state={state}
            reducedMotion={reducedMotion}
            onToggleMusic={() => actions.updateSettings({ musicEnabled: !save.settings.musicEnabled })}
          />
        )}
        {tab === "backpack" && <BackpackScreen save={save} onSell={actions.sell} onSellAll={actions.sellAll} />}
        {tab === "upgrade" && <UpgradeScreen save={save} onUpgrade={actions.upgrade} />}
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

      <TabBar tab={tab} onChange={actions.setTab} backpackCount={save.inventory.length} />
      <Toast toast={state.toast} onDone={actions.dismissToast} />

      {mode.kind === "minigame" && (
        <Minigame
          key={mode.startedAt}
          fishId={mode.fishId}
          reducedMotion={reducedMotion}
          onFinish={actions.finishMinigame}
          playSfx={actions.playSfx}
        />
      )}
      {mode.kind !== "minigame" && dialog?.kind === "offline" && <OfflineDialog dialog={dialog} onClose={actions.dismissDialog} />}
      {mode.kind !== "minigame" && dialog?.kind === "corrupt" && <CorruptDialog dialog={dialog} onClose={actions.dismissDialog} />}
      {mode.kind !== "minigame" && dialog?.kind === "catch" && <CatchResultDialog dialog={dialog} onClose={actions.dismissDialog} />}
      {mode.kind === "prompt" && !dialog && (
        <BitePrompt
          fishId={mode.fishId}
          shownAt={mode.shownAt}
          now={state.now}
          onReel={actions.startReel}
          onIgnore={actions.ignorePrompt}
        />
      )}
    </div>
  );
}
