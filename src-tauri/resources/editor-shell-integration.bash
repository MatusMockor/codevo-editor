if [ -f "$HOME/.bashrc" ]; then
  source "$HOME/.bashrc"
fi

__editor_uri_encode() {
  local value="$1"
  local encoded=""
  local char
  local code
  local i
  local LC_ALL=C

  for ((i = 0; i < ${#value}; i++)); do
    char="${value:i:1}"
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

__editor_prompt_command() {
  local status=$?
  local encoded_pwd
  encoded_pwd="$(__editor_uri_encode "$PWD")"
  printf '\033]133;D;%s\007' "$status"
  printf '\033]133;A\007'
  printf '\033]7;file://%s%s\007' "${HOSTNAME:-localhost}" "$encoded_pwd"
  trap '__editor_preexec' DEBUG
}

__editor_preexec() {
  trap - DEBUG
  printf '\033]133;C\007'
}

PROMPT_COMMAND="__editor_prompt_command${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
PS1="${PS1}\[\033]133;B\007\]"
trap '__editor_preexec' DEBUG
