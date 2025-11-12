#!/bin/sh

/scripts/pacman.conf.pl | sudo tee "/etc/pacman.conf" > /dev/null

if [ -n "$MIRROR" ]
then
    sudo sed -i "1iServer = $MIRROR" /etc/pacman.d/mirrorlist
fi


if [ -z "$REPO" ]
then
    /bin/bash
    exit $?;
else
    sudo pacman -Syu --noconfirm --noprogressbar
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

postEntrypoint() {
    if [ -n "$POST" ] && [ -x "./post-entrypoint.sh" ] ; then
        echo "EXECUTING POSTENTRY"
        ./post-entrypoint.sh
    fi
}

doBuild() {
    if [ -n "$POST" ] && [ -x "./post-entrypoint.sh" ] ; then
        makepkg -smf --noconfirm --noprogressbar --skippgpcheck
    else
        makepkg -smf --noconfirm --noprogressbar --skippgpcheck --noarchive
    fi
}

changeDir() {
    if [ -n "$CD" ]
    then
        cd "$CD"
    fi
}

DIR="${WORKSPACE:-/home/user/pkg}"

if [ ! -d "$DIR" ]; then
    git clone "$REPO" "$DIR" || exit $?
fi
cd "$DIR" && \
checkoutCommit && \
applyPatch && \
sudo pacman -Syu --noconfirm --noprogressbar &&\
doBuild && \
postEntrypoint
exit $?;
