original_zdotdir="${EDITOR_ORIGINAL_ZDOTDIR:-$HOME}"
if [[ -f "$original_zdotdir/.zprofile" ]]; then
  source "$original_zdotdir/.zprofile"
fi
unset original_zdotdir
