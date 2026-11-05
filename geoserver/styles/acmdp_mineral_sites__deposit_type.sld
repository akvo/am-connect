<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc" xmlns:xlink="http://www.w3.org/1999/xlink">
  <NamedLayer><Name>acmdp_mineral_sites</Name><UserStyle><Title>ACMDP sites by deposit type</Title>
    <FeatureTypeStyle>
      <Rule><Name>Laterite (436)</Name><Title>Laterite (436)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>deposit_type</ogc:PropertyName><ogc:Literal>Laterite</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#1f77b4</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>Placer (271)</Name><Title>Placer (271)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>deposit_type</ogc:PropertyName><ogc:Literal>Placer</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#ff7f0e</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>Chemical precipitation (151)</Name><Title>Chemical precipitation (151)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>deposit_type</ogc:PropertyName><ogc:Literal>Chemical precipitation</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#2ca02c</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>Low sulfidation Epithermal (125)</Name><Title>Low sulfidation Epithermal (125)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>deposit_type</ogc:PropertyName><ogc:Literal>Low sulfidation Epithermal</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#d62728</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>Weathering products (47)</Name><Title>Weathering products (47)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>deposit_type</ogc:PropertyName><ogc:Literal>Weathering products</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#9467bd</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>Late-stage quartz (43)</Name><Title>Late-stage quartz (43)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>deposit_type</ogc:PropertyName><ogc:Literal>Late-stage quartz</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#8c564b</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>Sedimentary / Surficial (37)</Name><Title>Sedimentary / Surficial (37)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>deposit_type</ogc:PropertyName><ogc:Literal>Sedimentary / Surficial</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#e377c2</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>Low Sulfidation Eptihermal (30)</Name><Title>Low Sulfidation Eptihermal (30)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>deposit_type</ogc:PropertyName><ogc:Literal>Low Sulfidation Eptihermal</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#17becf</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>Insitu weathering and leaching (25)</Name><Title>Insitu weathering and leaching (25)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>deposit_type</ogc:PropertyName><ogc:Literal>Insitu weathering and leaching</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#bcbd22</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>Epithermal-Low sulfide (22)</Name><Title>Epithermal-Low sulfide (22)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>deposit_type</ogc:PropertyName><ogc:Literal>Epithermal-Low sulfide</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#7f7f7f</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>High Sulfidation Eptihermal (18)</Name><Title>High Sulfidation Eptihermal (18)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>deposit_type</ogc:PropertyName><ogc:Literal>High Sulfidation Eptihermal</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#aec7e8</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>heavy mineral (17)</Name><Title>heavy mineral (17)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>deposit_type</ogc:PropertyName><ogc:Literal>heavy mineral</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#ffbb78</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>Other (2961)</Name><Title>Other (2961)</Title><ElseFilter/>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#9e9e9e</CssParameter><CssParameter name="fill-opacity">0.8</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>7</Size></Graphic></PointSymbolizer></Rule>
    </FeatureTypeStyle>
  </UserStyle></NamedLayer>
</StyledLayerDescriptor>
