original_zdotdir="${EDITOR_ORIGINAL_ZDOTDIR:-$HOME}"
if [[ -f "$original_zdotdir/.zshrc" ]]; then
  source "$original_zdotdir/.zshrc"
fi
unset original_zdotdir

autoload -Uz add-zsh-hook

__editor_uri_encode() {
  local value="$1"
  local encoded=""
  local char
  local code
  local i
  local LC_ALL=C

  for ((i = 1; i <= ${#value}; i++)); do
    char="${value[i]}"
    case "$char" in
      [A-Za-z0-9/_.~-]) encoded+="$char" ;;
      *)
        printf -v code '%d' "'$char"
        printf -v code '%02X' "$((code & 255))"
        encoded+="%$code"
        ;;
    esac
  done

  printf '%s' "$encoded"
}

__editor_precmd() {
  local status=$?
  local encoded_pwd
  encoded_pwd="$(__editor_uri_encode "$PWD")"
  printf '\033]133;D;%s\007' "$status"
  printf '\033]133;A\007'
  printf '\033]7;file://%s%s\007' "${HOST:-localhost}" "$encoded_pwd"
}

__editor_preexec() {
  printf '\033]133;C\007'
}

add-zsh-hook precmd __editor_precmd
add-zsh-hook preexec __editor_preexec
PROMPT="${PROMPT}%{\033]133;B\007%}"

if [[ -n "${EDITOR_ORIGINAL_ZDOTDIR+x}" ]]; then
  export ZDOTDIR="$EDITOR_ORIGINAL_ZDOTDIR"
else
  unset ZDOTDIR
fi
unset EDITOR_ORIGINAL_ZDOTDIR
