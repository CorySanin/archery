#!/bin/sh

if [ -n "$DEP" ] && [ "$DEP" != "stable" ]
then
    sudo cp "/scripts/pacman.conf/pacman.$DEP.conf" "/etc/pacman.conf" && \
    sudo pacman -Syu --noconfirm --noprogressbar
fi

if [ -z "$REPO" ]
then
    /bin/bash
    exit $?;
fi

checkoutCommit() {
    if [ -n "$COMMIT" ]
    then
        git checkout "$COMMIT"
    fi
}

applyPatch() {
    if [ -n "$PATCH" ]
    then
        printf "$PATCH" > ../build.patch && \
        patch --strip=1 --input=../build.patch
    fi
}

changeDir() {
    if [ -n "$CD" ]
    then
        cd "$CD"
    fi
}

if [ ! -d "/home/user/pkg" ]; then
    git clone "$REPO" /home/user/pkg || exit $?
fi
cd /home/user/pkg && \
checkoutCommit && \
applyPatch && \
sudo pacman -Syu --noconfirm --noprogressbar &&\
makepkg -smf --noconfirm --noprogressbar --skippgpcheck --noarchive
exit $?;
