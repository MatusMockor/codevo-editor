original_zdotdir="${EDITOR_ORIGINAL_ZDOTDIR:-$HOME}"
if [[ -f "$original_zdotdir/.zlogin" ]]; then
  source "$original_zdotdir/.zlogin"
fi
unset original_zdotdir
