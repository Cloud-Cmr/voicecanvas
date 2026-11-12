# 构建 APK 需要的前置条件

> 自动检测结果（2026-11-13）：本机 **Java 1.8 + 无 Android SDK + 无 Gradle**，
> 因此无法在本机直接产出 APK。工程本身已经生成并配置完毕（`android/` 目录）。

## 需要安装的三样东西

### 1. JDK 17（必须，当前是 1.8 太旧）

Capacitor 6 + Android Gradle Plugin 8 要求 **JDK 17**。

- 下载：https://adoptium.net/temurin/releases/?version=17
- 选 **Windows x64 .msi**，安装时勾选「Set JAVA_HOME variable」
- 验证：新开终端跑 `java -version`，应显示 `17.x`

### 2. Android SDK（命令行工具即可，不必装 Android Studio）

- 下载 Command line tools：https://developer.android.com/studio#command-tools
- 解压到 `D:\Android\sdk`，目录结构应为 `D:\Android\sdk\cmdline-tools\latest\bin\sdkmanager.bat`
- 设置环境变量：
  ```powershell
  [Environment]::SetEnvironmentVariable("ANDROID_HOME", "D:\Android\sdk", "User")
  ```
- 用 sdkmanager 装必要组件：
  ```powershell
  & "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" "platform-tools" "platforms;android-34" "build-tools;34.0.0"
  ```

### 3. 接受许可

```powershell
& "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" --licenses
```

## 然后一条命令出 APK

```powershell
cd D:\备份\Users\郁伟\Desktop\dsh\软件\voicecanvas
npm run apk
```

产物在这里：

```
android/app/build/outputs/apk/debug/app-debug.apk
```

可以直接发到手机安装（首次要允许「安装未知来源应用」）。

## 想要正式签名的 release APK

```powershell
# 1. 生成签名密钥（只需一次）
keytool -genkey -v -keystore voicecanvas.keystore -alias voicecanvas `
  -keyalg RSA -keysize 2048 -validity 10000

# 2. 在 android/keystore.properties 写：
#    storeFile=../../voicecanvas.keystore
#    storePassword=你的密码
#    keyAlias=voicecanvas
#    keyPassword=你的密码

# 3. 构建
cd android
.\gradlew.bat assembleRelease
```

产物：`android/app/build/outputs/apk/release/app-release.apk`

## 现阶段能用的替代品：PWA

在装好上面的工具链之前，已经可以做「装到手机主屏」的版本：

```powershell
npm run build:mobile
# 产物在 dist-mobile/，把整个目录放到任意静态托管
# 手机浏览器打开 → 菜单 → 「添加到主屏幕」
```

因为 MiMo API 已确认支持 CORS（`access-control-allow-origin: *`），
PWA 可以直接在手机浏览器里调用 API，功能上和 APK 一致，只是没有原生外壳。
