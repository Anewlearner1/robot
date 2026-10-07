export interface SongNameFieldProps {
  value: string
  onChange: (name: string) => void
  /** Recent song names, most recent first. */
  suggestions: string[]
}

const MAX_CHIPS = 6

/** Required song name input with recent-name chips and a native datalist. */
export function SongNameField({ value, onChange, suggestions }: SongNameFieldProps) {
  const chips = suggestions.filter((s) => s !== value.trim()).slice(0, MAX_CHIPS)
  return (
    <div class="field">
      <label class="field-label" for="song-name">
        歌名
      </label>
      <input
        id="song-name"
        class="text-input"
        type="text"
        list="song-name-list"
        value={value}
        placeholder="輸入要練的歌"
        autoComplete="off"
        enterKeyHint="next"
        maxLength={60}
        required
        onInput={(e) => onChange(e.currentTarget.value)}
      />
      <datalist id="song-name-list">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {chips.length > 0 && (
        <div class="chips" aria-label="最近唱過">
          {chips.map((s) => (
            <button key={s} type="button" class="chip" onClick={() => onChange(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
