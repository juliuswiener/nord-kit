#!/bin/sh
# askpass.sh — SUDO_ASKPASS helper for Claude Code (skill "interactive", rung 0).
# One dialog shows WHY sudo is asked for (NORD_SUDO_WHY, set by the agent: untrusted text) and
# WHICH command it runs. The command is read from /proc/$PPID/cmdline — the sudo process that started
# this helper — never from the environment or an argument, so the agent cannot forge it.
# The typed password goes to stdout and nowhere else. No readable command line -> no dialog, exit 1.
#
# zenity 4.2.2 --entry has no --no-markup and needs none: entry.c sets the text with
# gtk_label_set_text_with_mnemonic(g_strcompress(text)), and GTK escapes markup before it parses the
# mnemonics. What IS interpreted: "\" (g_strcompress) and "_" (mnemonic) — esc() doubles both.
# The label does not wrap, so wrap() breaks long lines here.
# ponytail: no height limit — a command of ~2500+ characters makes a dialog taller than the screen;
#   if that ever happens, fail closed above a limit. Look-alike and bidi Unicode in arguments is shown as is.

esc() { LC_ALL=C sed -e 's/\\/\\\\/g' -e 's/_/__/g'; }
wrap() { fold -s -w 72; }

# argv, NUL-separated -> shell-quoted words; control characters become $'..' escapes. Empty: no output.
cmd=$(LC_ALL=C od -An -v -tu1 "/proc/$PPID/cmdline" 2>/dev/null | LC_ALL=C awk '
function flush(   q) {
  q = cur == "" ? "\047\047" : safe ? cur : ctrl ? "$\047" q2 "\047" : "\047" q1 "\047"
  out = out (n++ ? " " : "") q; total += length(cur)
  cur = q1 = q2 = ""; safe = 1; ctrl = 0
}
BEGIN { safe = 1 }
{ for (i = 1; i <= NF; i++) {
    b = $i + 0
    if (b == 0) { flush(); continue }
    c = sprintf("%c", b); cur = cur c
    if (c !~ /[A-Za-z0-9_@%+=:,.\/-]/) safe = 0
    if (b < 32 || b == 127) {
      ctrl = 1; q1 = q1 c
      q2 = q2 (b == 9 ? "\\t" : b == 10 ? "\\n" : b == 13 ? "\\r" : b == 27 ? "\\e" : sprintf("\\x%02x", b))
    } else if (b == 39) { q1 = q1 "\047\\\047\047"; q2 = q2 "\\\047" }
    else if (b == 92) { q1 = q1 c; q2 = q2 "\\\\" }
    else { q1 = q1 c; q2 = q2 c }
  } }
END { if (cur != "") flush(); if (total > 0) print out }')
[ -n "$cmd" ] || { echo "askpass.sh: Befehlszeile von sudo (PID $PPID) nicht lesbar, kein Dialog" >&2; exit 1; }

# One line, no control characters: the reason cannot add lines of its own (no fake "Befehl:").
why=$(printf '%s' "${NORD_SUDO_WHY-}" | LC_ALL=C tr '[:cntrl:]' ' ' | sed -e 's/^ *//' -e 's/ *$//')
[ -n "$why" ] || why='NICHT ANGEGEBEN (der Agent hat keinen Grund genannt)'

text=$(printf '%s\n%s\n%s' 'Claude Code fragt nach deinem sudo-Passwort.' "Wofür: $why" "Befehl: $cmd" | wrap | esc)
exec zenity --entry --hide-text --title='sudo-Passwort für Claude Code' --text="$text" 2>/dev/null
