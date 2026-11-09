def reject_control($k):
  if test("[\u0000-\u001f\u007f]") then error($k + " contains a control character") else . end;

def typed($D; $k; $v):
  ($D[$k] | type) as $t
  | if $t == "boolean" then
      (if $v == "true" then true elif $v == "false" then false else error($k + " must be true or false") end)
    elif $t == "array" then
      (if ($v | test("^\\s*$")) then []
       elif ($v | test("^\\s*\\[")) then (($v | fromjson?) // error($k + " is not a valid JSON list"))
       else ($v | split(",") | map(gsub("^\\s+|\\s+$"; ""))) end)
      | if $k == "allowed_dashboard_servers" then
          (if type == "array" and all(.[]; type == "string" and length <= 1024 and (test("^//") | not) and test("^(https?://[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+|/[A-Za-z0-9._~!$&()*+,;=:@%/-]*)$")) then .
           else error($k + " must be a list of http(s) URLs or paths that begin with a single /, with no spaces, quotes or control characters") end)
        elif type == "array" and all(.[]; type == "string" and test("^[A-Za-z0-9_-]+$")) then .
        else error($k + " must be a list of panel names made of letters, digits, _ and -") end
    elif ($D[$k] | test("^/")) then
      ($v | reject_control($k))
      | if test("^/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$") and (test("^//") | not) then .
        else error($k + " must be a path that begins with a single / and holds only URL path characters") end
    else
      ($v | reject_control($k))
      | if length <= 1024 then . else error($k + " is longer than 1024 characters") end
    end;

$S[0] as $file
| $file.defaults as $D
| $file.presets[$preset] as $P
| (env
    | with_entries(select(.key | startswith("BANANA_SETTING_")))
    | with_entries(.key |= ltrimstr("BANANA_SETTING_"))) as $O
| ([$O | keys[] | select(. as $k | $D | has($k) | not)]) as $unknown
| if ($unknown | length) > 0 then
    error("unknown setting: " + ($unknown | join(", ")) + ". BANANA_SETTING_<name> accepts only " + ($D | keys | join(", ")))
  elif $O | has("FUSION_LOGIN_URL") then
    error("set the login URL with FUSION_LOGIN_URL, not BANANA_SETTING_FUSION_LOGIN_URL")
  else . end
| ($P + ($O | with_entries(.value = typed($D; .key; .value)))) as $merged
| if $variant == "mount" then
    $merged + {FUSION_LOGIN_URL: $D.FUSION_LOGIN_URL, FUSION_SESSION_API: $D.FUSION_SESSION_API}
  else
    $merged + {FUSION_LOGIN_URL: (typed($D; "FUSION_LOGIN_URL"; $loginUrl) | if test("^/[A-Za-z0-9._~/-]*$") and (test("^//") | not) and (test("\\.\\.") | not) then . else error("FUSION_LOGIN_URL must be a path that begins with a single / and holds only letters, digits and . _ ~ / -, with no ..") end)}
  end
