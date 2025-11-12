#!/usr/bin/env perl
use strict;
use warnings;

my $dep = $ENV{DEP} // 'stable';
my $tier = $ENV{TIER} // '1';

#region header
print <<'EOHEADER';
#
# /etc/pacman.conf
#

[options]
HoldPkg     = pacman glibc
Architecture = auto
NoProgressBar
VerbosePkgLists
ParallelDownloads = 5
DownloadUser = alpm
SigLevel    = Required DatabaseOptional
LocalFileSigLevel = Optional

EOHEADER
#endregion

#region system
if ($dep eq 'staging') {
    print <<'EOSYSTEMSTAGING';
[system-goblins]
Include = /etc/pacman.d/mirrorlist

EOSYSTEMSTAGING
}

if ($dep eq 'staging' || $dep eq 'testing') {
    print <<'EOSYSTEMTESTING';
[system-gremlins]
Include = /etc/pacman.d/mirrorlist

EOSYSTEMTESTING
}

print <<'EOSYSTEM';
[system]
Include = /etc/pacman.d/mirrorlist

EOSYSTEM
#endregion

#region world
if ($tier ne '0') {
    if ($dep eq 'staging') {
        print <<'EOWORLDSTAGING';
[world-goblins]
Include = /etc/pacman.d/mirrorlist

EOWORLDSTAGING
    }

    if ($dep eq 'staging' || $dep eq 'testing') {
        print <<'EOWORLDTESTING';
[world-gremlins]
Include = /etc/pacman.d/mirrorlist

EOWORLDTESTING
    }

    print <<'EOWORLD';
[world]
Include = /etc/pacman.d/mirrorlist

EOWORLD
}
#endregion

#region galaxy
if ($tier eq '2') {
    if ($dep eq 'staging') {
        print <<'EOGALAXYSTAGING';
[galaxy-goblins]
Include = /etc/pacman.d/mirrorlist

EOGALAXYSTAGING
    }

    if ($dep eq 'staging' || $dep eq 'testing') {
        print <<'EOGALAXYTESTING';
[galaxy-gremlins]
Include = /etc/pacman.d/mirrorlist

EOGALAXYTESTING
    }

    print <<'EOGALAXY';
[galaxy]
Include = /etc/pacman.d/mirrorlist

EOGALAXY
}
#endregion

#region options
print <<'EOOPTIONS';
[options]
NoExtract  = usr/share/help/* !usr/share/help/en* !usr/share/help/C/*
NoExtract  = usr/share/gtk-doc/html/* usr/share/doc/*
NoExtract  = usr/share/locale/* usr/share/X11/locale/* usr/share/i18n/*
NoExtract   = !*locale*/en*/* !usr/share/i18n/charmaps/UTF-8.gz !usr/share/*locale*/locale.*
NoExtract   = !usr/share/*locales/en_?? !usr/share/*locales/i18n* !usr/share/*locales/iso*
NoExtract   = !usr/share/*locales/trans*
NoExtract   = !usr/share/X11/locale/C/*
NoExtract   = !usr/share/X11/locale/compose.dir !usr/share/X11/locale/iso8859-1/*
NoExtract  = !usr/share/*locales/C !usr/share/*locales/POSIX !usr/share/i18n/charmaps/ANSI_X3.4-1968.gz
NoExtract  = usr/share/man/* usr/share/info/*
NoExtract  = usr/share/vim/vim*/lang/*
EOOPTIONS
#endregion
