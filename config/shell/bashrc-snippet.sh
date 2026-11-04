# >>> welcome-screen (remove this block to disable) >>>
if [[ $- == *i* ]] && [ -z "$TERM_PROGRAM" ] && [ -z "$CLAUDECODE" ] && [ -z "$SSH_TTY" ] && [ -x "$HOME/.local/bin/welcome" ]; then
  "$HOME/.local/bin/welcome"
fi
# <<< welcome-screen <<<

# >>> prompt-style "I Found You" (remove this block to get the old prompt back) >>>
__ify_prompt() {
  local code=$?
  local dark='\[\e[38;2;74;64;64m\]' warm='\[\e[1;38;2;230;221;211m\]' sage='\[\e[38;2;143;179;154m\]'
  local red='\[\e[38;2;232;44;58m\]' amber='\[\e[38;2;217;164;108m\]' r='\[\e[0m\]'
  local branch; branch=$(git symbolic-ref --short HEAD 2>/dev/null)
  local status=""; [ $code -ne 0 ] && status=" ${amber}✗ ${code}${r}"
  PS1="${dark}╭─${r} ${warm}\w${r}${branch:+ ${sage}⎇ ${branch}${r}}${status}\n${dark}╰─${red}❯${r} "
}
PROMPT_COMMAND=__ify_prompt
# <<< prompt-style <<<

# >>> terminal-tools "I Found You" (remove this block to undo) >>>
# ls → eza: folders first, colors from the theme
if command -v eza >/dev/null; then
  export EZA_COLORS="di=1;38;2;230;221;211:ex=38;2;232;44;58:ln=38;2;143;179;154:or=38;2;255;77;90:fi=38;2;207;198;188:\
*.md=38;2;217;164;108:*.pdf=38;2;194;102;122:*.zip=38;2;125;143;168:*.tar.gz=38;2;125;143;168:\
*.py=38;2;143;179;176:*.js=38;2;217;164;108:*.sh=38;2;232;44;58:\
da=38;2;110;98;96:uu=38;2;110;98;96:sn=38;2;143;179;154:sb=38;2;90;79;79:\
ur=38;2;217;164;108:uw=38;2;232;44;58:ux=38;2;143;179;154:gr=38;2;110;98;96:gw=38;2;110;98;96:gx=38;2;110;98;96:\
tr=38;2;90;79;79:tw=38;2;90;79;79:tx=38;2;90;79;79:xx=38;2;74;64;64"
  alias ls='eza --group-directories-first'
  alias ll='eza -l --group-directories-first --git --time-style=relative --no-user --header'
  alias la='eza -la --group-directories-first --git --time-style=relative --no-user'
  alias tree='eza --tree --level=2 --group-directories-first'
fi
# cat → bat with syntax colors (uses the terminal theme)
if command -v batcat >/dev/null; then
  export BAT_THEME=ansi
  alias cat='batcat --paging=never --style=plain'
  alias preview='batcat --style=numbers,grid'
fi
# fzf: Ctrl+R history search, Ctrl+T file search, Alt+C jump to folder
if command -v fzf >/dev/null; then
  export FZF_DEFAULT_OPTS="--height=45% --layout=reverse --border=rounded --margin=0,1 --info=inline-right \
--prompt='❯ ' --pointer='●' --marker='◆' --separator='─' \
--color=bg:-1,bg+:#1c1818,fg:#cfc6bc,fg+:#f5eee6,hl:#e82c3a,hl+:#ff4d5a \
--color=border:#4a4040,prompt:#e82c3a,pointer:#e82c3a,marker:#d9a46c,info:#6e6260,spinner:#e82c3a,header:#8fb39a"
  [ -f /usr/share/doc/fzf/examples/key-bindings.bash ] && . /usr/share/doc/fzf/examples/key-bindings.bash
fi
# z → smart cd that remembers your folders ("z laptop" jumps to ~/laptop-upgrades)
command -v zoxide >/dev/null && eval "$(zoxide init bash)" && PROMPT_COMMAND="__ify_prompt;__zoxide_hook"
# <<< terminal-tools <<<
