ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG SHELL_MAJOR
LABEL io.github.guleoo.clipboard-x-gnome.test-environment="1"
RUN dnf install -y --setopt=install_weak_deps=False \
      7zip dbus-daemon dbus-tools gettext git gjs glib2 glibc-langpack-en \
      glibc-langpack-ja glibc-langpack-ko glibc-langpack-zh gnome-shell \
      gnome-text-editor nautilus gtk3 gtk4 libadwaita libsoup3 meson ninja-build \
      nodejs python3 python3-gobject vte291 gvfs gvfs-client \
      xdg-desktop-portal-gnome xdg-desktop-portal-gtk gnome-keyring \
      mesa-dri-drivers mesa-libEGL dejavu-sans-fonts google-noto-sans-cjk-fonts \
      google-noto-color-emoji-fonts chromium firefox openssl procps-ng util-linux \
    && dnf clean all \
    && test "$(gnome-shell --version | sed -nE 's/^GNOME Shell ([0-9]+).*/\1/p')" = "$SHELL_MAJOR" \
    && useradd --uid 1000 --create-home tester \
    && rpm -qa | sort > /opt/test-packages.txt
# Shell's text-input/Unicode path needs its standard framework, not a Pinyin engine.
RUN dnf install -y --setopt=install_weak_deps=False ibus \
    && dnf clean all \
    && rpm -qa | sort > /opt/test-packages.txt
ENV CBX_TEST_SHELL=${SHELL_MAJOR} \
    LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LANGUAGE=en_US \
    GTK_IM_MODULE=wayland GTK_A11Y=none NO_AT_BRIDGE=1 \
    LIBGL_ALWAYS_SOFTWARE=1 GSK_RENDERER=cairo \
    XDG_CURRENT_DESKTOP=GNOME XDG_SESSION_TYPE=wayland
COPY session.py /opt/test-session.py
ENTRYPOINT ["python3", "/opt/test-session.py"]
