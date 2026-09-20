import { useEffect, useId, useRef, useState } from 'react'
import { suggest } from '../api'
import type { Suggestion } from '../../server/geocoder/suggestAdapter'

interface Props {
  id: string
  label: string
  kind: 'city' | 'street'
  value: string
  onChange: (value: string) => void
  /** Wywolywane przy wyborze z listy - niesie punkt do zawezenia kolejnych podpowiedzi. */
  onPick?: (s: Suggestion) => void
  /** Okolica, w ktorej szukac podpowiedzi ulic (punkt wybranej miejscowosci). */
  near?: { lat: number; lon: number } | null
  placeholder?: string
  disabled?: boolean
  required?: boolean
  autoComplete?: string
  hint?: string
}

const DEBOUNCE_MS = 250
const MIN_CHARS = 3

/**
 * Pole tekstowe z podpowiedziami nazw.
 *
 * Podpowiedz wypelnia WYLACZNIE tresc pola - wspolrzedne punktu ustala
 * pozniej oficjalna kaskada GUGiK. Lista jest udogodnieniem: kazda nazwe
 * mozna nadal wpisac recznie, a awaria uslugi podpowiedzi nie blokuje
 * wyszukiwania.
 */
export default function Autocomplete({
  id,
  label,
  kind,
  value,
  onChange,
  onPick,
  near,
  placeholder,
  disabled,
  required,
  autoComplete,
  hint,
}: Props) {
  const [items, setItems] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)

  const boxRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Po wyborze z listy wartosc pola sie zmienia - bez tej blokady efekt
  // natychmiast odpytalby usluge i lista otworzylaby sie z powrotem.
  const skipNextRef = useRef(false)
  const listId = useId()

  useEffect(() => {
    if (skipNextRef.current) {
      skipNextRef.current = false
      return
    }
    const q = value.trim()
    if (q.length < MIN_CHARS) {
      setItems([])
      setOpen(false)
      setLoading(false)
      return
    }

    const ctrl = new AbortController()
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const out = await suggest(kind, q, near ?? null, ctrl.signal)
        setItems(out)
        setActive(-1)
        setOpen(out.length > 0)
      } catch {
        // Anulowanie zapytania albo awaria uslugi - lista po prostu sie nie pokaze.
        setItems([])
        setOpen(false)
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [value, kind, near])

  // Klikniecie poza polem zamyka liste.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const pick = (s: Suggestion) => {
    skipNextRef.current = true
    onChange(s.value)
    onPick?.(s)
    setOpen(false)
    setActive(-1)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || !items.length) {
      // Strzalka w dol przy zamknietej, wypelnionej liscie otwiera ja z powrotem.
      if (e.key === 'ArrowDown' && items.length) {
        setOpen(true)
        setActive(0)
        e.preventDefault()
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((i) => (i + 1) % items.length)
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((i) => (i <= 0 ? items.length - 1 : i - 1))
        break
      case 'Enter':
        // Enter wybiera podswietlona pozycje zamiast wysylac formularz.
        if (active >= 0) {
          e.preventDefault()
          pick(items[active])
        }
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        setActive(-1)
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  return (
    <div className="ac" ref={boxRef}>
      <label htmlFor={id}>
        {label}
        {loading && <span className="ac-load" aria-hidden="true" />}
      </label>
      <input
        id={id}
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => items.length && setOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoComplete={autoComplete}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
      />
      {hint && <p className="hint ac-hint">{hint}</p>}

      {open && items.length > 0 && (
        <ul className="ac-list" id={listId} role="listbox" aria-label={label}>
          {items.map((s, i) => (
            <li
              key={`${s.value}|${s.context}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`ac-item${i === active ? ' on' : ''}`}
              // mousedown zamiast click: wyprzedza blur pola, wiec lista
              // nie zdazy sie zamknac przed wyborem.
              onMouseDown={(e) => {
                e.preventDefault()
                pick(s)
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="ac-name">{s.value}</span>
              {s.context && <span className="ac-ctx">{s.context}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
