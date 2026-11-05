<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc" xmlns:xlink="http://www.w3.org/1999/xlink">
  <NamedLayer><Name>acmdp_mineral_sites</Name><UserStyle><Title>ACMDP sites by status</Title>
    <FeatureTypeStyle>
      <Rule><Name>Under Development (1764)</Name><Title>Under Development (1764)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>status</ogc:PropertyName><ogc:Literal>Under Development</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#1f77b4</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>Operating (1436)</Name><Title>Operating (1436)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>status</ogc:PropertyName><ogc:Literal>Operating</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#ff7f0e</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>Suspended (425)</Name><Title>Suspended (425)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>status</ogc:PropertyName><ogc:Literal>Suspended</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#2ca02c</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>Abandoned (182)</Name><Title>Abandoned (182)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>status</ogc:PropertyName><ogc:Literal>Abandoned</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#d62728</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>N/A (2)</Name><Title>N/A (2)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>status</ogc:PropertyName><ogc:Literal>N/A</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#9467bd</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>Development and Construction (1)</Name><Title>Development and Construction (1)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>status</ogc:PropertyName><ogc:Literal>Development and Construction</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#8c564b</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>Cancelled (1)</Name><Title>Cancelled (1)</Title>
        <ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>status</ogc:PropertyName><ogc:Literal>Cancelled</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#e377c2</CssParameter><CssParameter name="fill-opacity">0.9</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>8</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>Not stated (372)</Name><Title>Not stated (372)</Title><ElseFilter/>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#9e9e9e</CssParameter><CssParameter name="fill-opacity">0.8</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>7</Size></Graphic></PointSymbolizer></Rule>
    </FeatureTypeStyle>
  </UserStyle></NamedLayer>
</StyledLayerDescriptor>
