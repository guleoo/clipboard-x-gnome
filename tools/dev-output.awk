# Presentation only: the unfiltered stream has already been forwarded to journal.
function show(line) {
    print line
    fflush()
}

function system_message(level, message, key) {
    if (key in seen) {
        repeated++
        return
    }
    if (count < 128) {
        seen[key] = 1
        count++
    }
    show("[" level "] " message)
}

{
    if (verbose == 1) {
        show($0)
        next
    }
    # Remove GJS/GLib's process prefix; keep the plugin's own readable line.
    if (match($0, /Clipboard X Gnome \[(INFO|WARN|ERROR|BUILD)\] /)) {
        show(substr($0, RSTART + length("Clipboard X Gnome ")))
        next
    }
    if ($0 ~ /^Installing |^Running custom install script|^Program .*found:|^Source dir:|^Build dir:/ ||
        $0 ~ /^Errors from xkbcomp are not fatal/) {
        next
    }
    lower = tolower($0)
    if (lower ~ /already disposed/) {
        system_message("WARN", "GNOME: UI object already disposed; full details are in journal", "disposed")
        next
    }
    if ($0 ~ /^[[:space:]]*>[[:space:]]*Warning:/) {
        system_message("WARN", "xkbcomp: keyboard map warnings; full details are in journal", "xkbcomp")
        next
    }
    if (lower ~ /error|critical|failed|failure|cannot|could not|no such file|invalid mit-magic-cookie|segmentation fault|core dumped|exited with code|fatal/ || $0 ~ /缺少|拒绝|失败/) {
        system_message("ERROR", $0, $0)
        next
    }
    if (lower ~ /warning/ || $0 ~ /未找到/) {
        system_message("WARN", $0, $0)
        next
    }
    # Successful build metadata, installation lists and service activation are hidden.
}

END {
    if (verbose != 1 && repeated > 0)
        show("[INFO] " repeated " repeated system messages hidden; full details are in journal")
}
