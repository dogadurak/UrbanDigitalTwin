import React, { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { scoreColor } from '../api';

/**
 * The 12 held-out city blocks, coloured by how well the model transfers to them.
 *
 * Markers are BDG2 site centroids, which the dataset documents as accurate only
 * to city level (every building within 40 km). They therefore locate a city, not
 * a building, and are drawn as wide translucent discs rather than pins so the
 * uncertainty is visible rather than implied away.
 *
 * OpenStreetMap raster imagery is used deliberately: it needs no Cesium ion
 * token, so a fresh clone renders a globe instead of a black screen.
 */
export default function GlobeMap({ blocks, selected, onSelect }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const viewer = new Cesium.Viewer(containerRef.current, {
      baseLayer: Cesium.ImageryLayer.fromProviderAsync(
        Promise.resolve(new Cesium.UrlTemplateImageryProvider({
          url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          credit: new Cesium.Credit('© OpenStreetMap contributors', true),
          maximumLevel: 19,
        })),
      ),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
    });

    viewer.scene.globe.enableLighting = false;
    // Let Cesium drop labels that would overlap rather than stacking them.
    viewer.entities.collectionChanged.addEventListener(() => {
      if (viewer.scene.primitives) viewer.scene.requestRender();
    });
    viewer.scene.skyAtmosphere.show = true;
    viewer.cesiumWidget.creditContainer.style.display = 'none';
    viewerRef.current = viewer;

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // Redraw markers whenever the results change.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !blocks) return;
    viewer.entities.removeAll();

    const located = blocks.filter((b) => b.lat != null && b.lng != null);
    located.forEach((b) => {
      const colour = Cesium.Color.fromCssColorString(scoreColor(b.cv_rmse));
      viewer.entities.add({
        id: b.block,
        position: Cesium.Cartesian3.fromDegrees(b.lng, b.lat),
        // 40 km radius: the dataset's own positional uncertainty, drawn to scale.
        ellipse: {
          semiMajorAxis: 40000,
          semiMinorAxis: 40000,
          material: colour.withAlpha(0.28),
          outline: true,
          outlineColor: colour.withAlpha(0.9),
          height: 0,
        },
        point: {
          pixelSize: b.block === selected ? 16 : 10,
          color: colour,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: b.block === selected ? 3 : 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          // Only the block name by default. The London and Ottawa blocks sit
          // within a few kilometres of each other, so drawing every site name
          // and score at this zoom produced an unreadable pile; the score
          // appears on the selected city and in the side list instead.
          text: b.block === selected
            ? `${b.sites.join(' / ')}  ${b.cv_rmse ?? '?'}%`
            : b.block,
          font: b.block === selected ? 'bold 13px system-ui, sans-serif'
                                     : '12px system-ui, sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -20),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          // Cesium hides a label rather than overlapping a higher-priority one.
          translucencyByDistance: undefined,
          showBackground: b.block === selected,
          backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.75),
          backgroundPadding: new Cesium.Cartesian2(6, 4),
        },
      });
    });

    if (located.length) {
      viewer.camera.flyHome(0);
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(-45, 45, 14000000),
      });
    }
  }, [blocks, selected]);

  // Clicking a city selects it.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !onSelect) return;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement) => {
      const picked = viewer.scene.pick(movement.position);
      if (Cesium.defined(picked) && picked.id && picked.id.id) onSelect(picked.id.id);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    return () => handler.destroy();
  }, [onSelect]);

  return <div ref={containerRef} className="w-full h-full" />;
}
