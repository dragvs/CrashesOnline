#!/bin/bash

# TODO Insert actual path
#srcdir="/Users/dragvs/Dev/Tools/google-breakpad"

prefixdir=$srcdir

echo "**********"
echo "Src dir: $srcdir"
echo "**********"


ANDROID_NDK="/Applications/android-ndk-r9c"
TOOLCHAIN="$ANDROID_NDK/toolchains/arm-linux-androideabi-4.8/prebuilt/darwin-x86_64"
ISYSTEM="$ANDROID_NDK/toolchains/llvm-3.3/prebuilt/darwin-x86_64/lib/clang/3.3/include"
SYSROOT="$ANDROID_NDK/platforms/android-9/arch-arm"
TARGET="armv7-none-linux-androideabi"


export CC="$ANDROID_NDK/toolchains/llvm-3.3/prebuilt/darwin-x86_64/bin/clang"
export LD="ld_unused"
export AS="$TOOLCHAIN/bin/arm-linux-androideabi-as"
export AR="$TOOLCHAIN/bin/arm-linux-androideabi-ar"
export RANLIB="$TOOLCHAIN/bin/arm-linux-androideabi-ranlib"

# Notes:
# isystem - deprecated? Use -I to STL?
# --sysroot - linker flag

# -D__thumb__ -mthumb
export CFLAGS="-fpic -ffunction-sections -funwind-tables -fstack-protector"
export CFLAGS="$CFLAGS -DANDROID"
export CFLAGS="$CFLAGS -target $TARGET -march=armv7-a -mfpu=vfpv3-d16 -mfloat-abi=softfp -marm"
export CFLAGS="$CFLAGS -isystem $ISYSTEM -gcc-toolchain $TOOLCHAIN"
export CFLAGS="$CFLAGS -I$SYSROOT/usr/include --sysroot=$SYSROOT -O2"
# STL
export CFLAGS="$CFLAGS -I$ANDROID_NDK/sources/cxx-stl/gnu-libstdc++/4.8/include -I$ANDROID_NDK/sources/cxx-stl/gnu-libstdc++/4.8/libs/armeabi-v7a/include -I$ANDROID_NDK/sources/cxx-stl/gnu-libstdc++/4.8/include/backward"
# special
export CFLAGS="$CFLAGS -I$srcdir/src/common/android/include -I$srcdir/src"

export LDFLAGS="$CFLAGS $ANDROID_NDK/sources/cxx-stl/gnu-libstdc++/4.8/libs/armeabi-v7a/libgnustl_static.a -L$ANDROID_NDK/platforms/android-9/arch-arm/usr/lib"

export CXX="$CC"
#export CPPFLAGS="$CFLAGS"
export CXXFLAGS="$CFLAGS"

echo " "
echo "[compiler & flags]: $CC $CFLAGS"
echo " "

./configure \
	-v \
	--prefix=$prefixdir/output \
	--host=arm-linux && \
#	--disable-shared \
#	--enable-static && \
make && \
make install prefix=$prefixdir/output
