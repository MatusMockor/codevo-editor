original_zdotdir="${EDITOR_ORIGINAL_ZDOTDIR:-$HOME}"
if [[ -f "$original_zdotdir/.zshenv" ]]; then
  source "$original_zdotdir/.zshenv"
fi
unset original_zdotdir
