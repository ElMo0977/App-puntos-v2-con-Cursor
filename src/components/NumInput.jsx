import React, { useState, useEffect } from 'react';

const round01 = (n) => Math.round(n * 10) / 10;
const parseNum = (v, fb = 0) => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : fb;
};

// Input numérico tolerante (spinner = inmediato; tecleo = al salir/Enter)
function NumInput({ value, onCommit, className, title }) {
  const [txt, setTxt] = useState('');
  const [focus, setFocus] = useState(false);
  const [typing, setTyping] = useState(false); // true cuando el usuario está tecleando

  useEffect(() => {
    if (!focus) {
      setTxt('');
      setTyping(false);
    }
  }, [value, focus]);

  const display = focus ? txt : String(value);
  const re = /^-?\d*(?:[.,]\d*)?$/; // vacío, dígitos y separador . o ,

  return (
    <input
      type="number"
      step={0.1}
      lang="en" // asegura que el "." del teclado numérico funcione
      inputMode="decimal"
      value={display}
      title={title}
      onFocus={() => {
        setFocus(true);
        setTxt(Number(value).toFixed(1));
        setTyping(false);
      }}
      onChange={(e) => {
        const el = e.target;
        const s = el.value;
        if (s === '' || re.test(s)) {
          setTxt(s);
          // Si NO estamos tecleando (spinner/rueda), confirmamos al instante
          if (!typing) {
            const n = round01(parseNum(s === '' ? String(value) : s, value));
            setTxt(n.toFixed(1));
            onCommit(n);
          }
        }
      }}
      onBlur={() => {
        setFocus(false);
        const n = round01(
          parseNum(display === '' ? String(value) : display, value)
        );
        onCommit(n);
        setTyping(false);
      }}
      onKeyDown={(e) => {
        // Flechas / PageUp-PageDown => commit inmediato
        if (
          e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'PageUp' ||
          e.key === 'PageDown'
        ) {
          e.preventDefault();
          const step = e.key === 'PageUp' || e.key === 'PageDown' ? 1.0 : 0.1;
          const dir = e.key === 'ArrowUp' || e.key === 'PageUp' ? 1 : -1;
          const base = focus
            ? parseNum(display === '' ? String(value) : display, value)
            : value;
          const next = round01(base + dir * step);
          setTxt(next.toFixed(1));
          onCommit(next);
          setTyping(false);
          return;
        }
        if (e.key === 'Enter') {
          e.target.blur();
          return;
        }
        // Cualquier otra tecla de edición => modo tecleo (commit al salir/Enter)
        if (
          (e.key.length === 1 && /[0-9.,-]/.test(e.key)) ||
          e.key === 'Backspace' ||
          e.key === 'Delete'
        ) {
          setTyping(true);
        }
      }}
      className={className}
    />
  );
}

export default NumInput;
