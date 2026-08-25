# 🏙️ Urban Digital Twin - Frontend

Bu proje, fiziksel altyapı ile dijital izleme dünyasını birleştiren gerçek zamanlı bir 3D simülasyon ve akıllı tesis (Smart Facility) yönetim panelidir.

## 🎯 Amaç
Projenin temel amacı, karmaşık bina verilerini (IoT sensörleri, HVAC sistemleri, enerji tüketimi, güvenlik kameraları ve personel hareketleri) tarayıcı üzerinden 3D bir ortamda gerçek zamanlı, anlaşılır ve etkileşimli bir şekilde görselleştirmektir. Bu dijital ikiz (Digital Twin), tesis yöneticilerine olaylara anında müdahale etme ve senaryo analizi (What-If) yapma imkanı sunar.

## ✅ Yaptıklarımız
- **Teknoloji Yığını (Stack):** React, Vite, Tailwind CSS, Three.js (React Three Fiber, Drei), Zustand ve Socket.io kullanılarak modern ve performanslı bir altyapı kuruldu.
- **3D Bina Modellemesi:**
  - Kat planları, cam cepheler (PBR glass), taşıyıcı kolonlar, HVAC havalandırma boruları ve asansör sistemleri üç boyutlu olarak kodlandı.
  - Sunucu odaları (IT yükü) ve çatıdaki soğutma (Chiller) sistemleri eklendi.
  - PostProcessing efektleri (Bloom, Ambient Occlusion vb.) ile yüksek görsel kalite elde edildi.
- **Gerçek Zamanlı Veri ve Durum Yönetimi:**
  - Backend üzerinden 1Hz (saniyede 1) hızında gelen telemetri verilerinin anlık olarak 3D sahneye ve UI panellerine (Dashboard) yansıması sağlandı (Zustand & Socket.io).
- **Görünüm Modları:**
  - **Normal:** Standart bina görünümü ve kat izleme.
  - **Enerji (Heatmap):** Sunucu odaları ve alanların ısı/enerji tüketim analizi.
  - **HVAC (X-Ray):** Dış cephenin gizlenerek havalandırma ve boru tesisatının görünür kılınması.
  - **Güvenlik & Yangın:** Kameraların aktifleşmesi, duman dedektörlerinin çalışması ve acil durum ışıklandırmaları.
- **Yapay Zeka ve Simülasyon:**
  - Binada serbestçe dolaşan yapay zeka (AI) destekli insan (occupant) simülasyonu yapıldı.
  - **Tahliye (Evacuation) Pathfinding:** Yangın alarmı durumunda insanların en yakın çekirdek asansör/merdiven boşluğuna yönelmesi sağlandı.
  - Çeşitli sabotaj/kriz senaryoları (Yangın, HVAC Sızıntısı vb.) sisteme entegre edildi.
- **Zaman Makinesi (Time-Travel):** Geçmiş telemetri verilerinin zaman çizelgesi (timeline) üzerinden tekrar oynatılabilmesi (rewind) sağlandı.

## 🚀 Şu Anki Aşama
- Projenin **MVP (Minimum Viable Product)** ve **Prototip** aşaması başarıyla tamamlanmıştır.
- Backend ile frontend arasındaki Socket.io tabanlı anlık iletişim, 3D render performansı ve acil durum senaryo simülasyonları stabil bir şekilde çalışmaktadır.
- Şu anda sistem simüle edilmiş veriler ve senaryolar üzerinden mükemmel bir demonstrasyon sunabilmektedir.

## 🔮 Hedefler
- **Gerçek IoT Entegrasyonu:** Simüle edilen verilerin yerine fiziksel bir binadaki gerçek IoT sensörlerinin (MQTT vb. protokoller aracılığıyla) sisteme bağlanması.
- **Veritabanı Entegrasyonu:** Zaman çizelgesi verilerinin ve geçmiş logların kalıcı olarak saklanması için veritabanı (PostgreSQL/MongoDB) kurulumu.
- **Kullanıcı Yönetimi:** Rol tabanlı erişim kontrolü (Yetkilendirme ve Kimlik Doğrulama - Auth) eklenmesi.
- **Gelişmiş Analitik Ekranları:** React Recharts ve benzeri kütüphanelerle 3D ekranın yanı sıra daha detaylı istatistiksel 2D raporlama ekranlarının geliştirilmesi.
- **VR/AR Desteği:** İlerleyen aşamalarda WebXR ile kullanıcıların binayı sanal gerçeklik gözlükleri ile de deneyimleyebilmesi.

## ⚠️ Eksik Kalan ve Sonuca Gidemediğimiz Yerler (Mevcut Başarısızlıklar)
Şu anki haliyle bu proje, gerçek ve profesyonel bir **Digital Twin (Dijital İkiz)** olmaktan çok uzaktır. Görselleştirme ve altyapı açısından çok büyük eksiklikler barındırmaktadır; aslında oldukça başarısız (fail) bir durumdayız:
- **Gerçeklikten Uzaklık:** 3D modelleme tamamen jenerik ve basit geometrik nesnelerden ibarettir. Gerçek bir binanın BIM (Building Information Modeling) verisine veya detaylı mimari modeline dayanmamaktadır.
- **Mekansal Hata:** Tesisin gerçek boyutları, fiziki dinamikleri (örneğin termodinamik, hava akışı) veya materyal analizleri tamamen göz ardı edilmiştir.
- **Veri Gerçekliği Yok:** Sistemdeki veriler tamamen simüle edilmiş (mock) olup, sahadan toplanan karmaşık ve düzensiz veri yapılarını yansıtmamaktadır. İnsan simülasyonları da çok temel düzeyde (rastgele yürüme) kalmıştır.
- **Ölçeklenebilirlik Sorunu:** Mevcut prototip mimarisi, gerçek bir tesisteki yüz binlerce sensörden aynı anda gelecek devasa veriyi (Big Data) işlemek, filtrelemek ve anlık tepki vermek için optimize edilmemiştir.

## 💡 Geliştirme Önerileri (Uzmanlar Yapsa Nasıl İlerlerdi?)
Eğer bu proje endüstri uzmanları tarafından gerçek bir ürüne dönüştürülmek üzere yapılsaydı şu şekilde bir yol izlenirdi:
- **BIM Entegrasyonu:** Projeye IFC formatında detaylı mimari, elektrik ve mekanik (MEP) projeleri yüklenir ve Three.js tarafına IFC.js, Cesium veya Autodesk Forge (APS) kullanılarak aktarılırdı.
- **Endüstriyel Veri Akışı:** Node.js + Socket.io yerine, AWS IoT TwinMaker, Azure Digital Twins gibi endüstriyel bulut platformları ve veri akışı (streaming) için Kafka / Kinesis gibi teknolojiler kullanılırdı.
- **Yüksek Sadakatli (High-Fidelity) Simülasyon:** Sadece görünüm olarak değil, Ansys gibi yazılımlarla entegre edilerek ısı dağılımı (CFD analizi) ve yapısal stres gibi veriler fiziksel doğrulukla işlenirdi.
- **Kestirimci Bakım (Predictive Maintenance):** Yapay zeka sadece anlık durumu göstermek için değil, geçmiş sensör verilerini işleyerek olası donanım arızalarını önceden tahmin etmek (ML Pipeline) için kullanılırdı.
- **Nokta Bulutu (Point Cloud):** 3D model manuel çizilmek yerine, binanın lazer taraması (LiDAR/Fotogrametri) yapılarak 3D Tiles formatında dijital ortama aktarılırdı.
