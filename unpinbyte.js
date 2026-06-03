setTimeout(function () {
    Java.perform(function () {
        console.log("=== HTTP Toolkit 专用强 Unpin ===");

        // 1. 绕过 OkHttp & 字节 OkHttp
        try {
            Java.use("okhttp3.CertificatePinner").check.implementation = function () { };
            Java.use("com.bytedance.okhttp3.CertificatePinner").check.implementation = function () { };
            console.log("✅ OkHttp 证书固定已绕过");
        } catch (e) { }

        // 2. 全局信任所有证书
        try {
            let X509TrustManager = Java.use("javax.net.ssl.X509TrustManager");
            let TrustAll = Java.registerClass({
                name: "com.httptoolkit.trust",
                implements: [X509TrustManager],
                methods: {
                    checkClientTrusted: function () { },
                    checkServerTrusted: function () { },
                    getAcceptedIssuers: function () { return []; }
                }
            });
            let SSLContext = Java.use("javax.net.ssl.SSLContext");
            SSLContext.getInstance.implementation = function (t) {
                let ctx = SSLContext.getInstance.call(this, "TLS");
                ctx.init(null, [TrustAll.$new()], null);
                return ctx;
            };
            console.log("✅ 全局 SSL 信任已开启");
        } catch (e) { }

        // 3. 绕过系统代理检测（HTTP Toolkit VPN 专用）
        try {
            Java.use("java.lang.System").getProperty.implementation = function (k) {
                if (k && k.includes("proxy")) return null;
                return this.getProperty(k);
            };
            Java.use("java.net.ProxySelector").getDefault.implementation = function () {
                return null;
            };
            console.log("✅ 代理检测已屏蔽");
        } catch (e) { }

        // 4. 绕过 Android 7+ 网络安全限制
        try {
            Java.use("android.security.net.config.NetworkSecurityConfigProvider").getConfig.implementation = function () {
                return null;
            };
        } catch (e) { }

        console.log("=== 注入完成，HTTP Toolkit 可正常抓包 ===");
    });
}, 1500);