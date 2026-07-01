
## 這份程式碼驗證到什麼程度（請務必先看這段）

開發環境是 Linux 容器，沒有 rustup（只能用 apt 裝到 rustc 1.75），也沒有 Windows
SDK / WebView2。實際嘗試 `cargo check` 後，crates.io 上 wry 0.55 的依賴鏈（例如
`hashbrown`、`dlopen2_derive` 等）已經要求 `edition2024`，需要 Rust 1.85+ 才能解析，
apt 裝的 1.75 完全跑不動，逐一鎖定舊版子依賴也只是打地鼠，治標不治本。

**結論：這份程式碼完全沒有被編譯器驗證過**，是依照官方文件、原始碼（docs.rs 上
wry 0.55.1 / tao 0.35 的實際 rustdoc 與 GitHub 上的真實範例）逐項核對 API 簽名後寫的，
但沒有實機編譯。請在你的 Windows 機器上跑：

```powershell
cargo build
```

由於 rust 環境難以建置，所以你不用測試建置，直接輸出 zip 給我，我建置有問題跟你說，輸出的 zip 一樣叫做 cimg.zip，裡面直接包含兩個資料夾 cimg-rs 和 cimg-rs，不用資料夾 cimg，你還有問題嗎