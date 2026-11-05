<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc" xmlns:xlink="http://www.w3.org/1999/xlink">
  <NamedLayer><Name>thailand_mineral_sites</Name><UserStyle><Title>Mineral sites by grade (graduated symbols)</Title>
    <FeatureTypeStyle>
      <Rule><Name>under 0.5 %</Name><Title>under 0.5 %</Title>
        <ogc:Filter><ogc:PropertyIsLessThan><ogc:PropertyName>grade_pct</ogc:PropertyName><ogc:Literal>0.5</ogc:Literal></ogc:PropertyIsLessThan></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#8e44ad</CssParameter><CssParameter name="fill-opacity">0.7</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>6</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>0.5 - 1.5 %</Name><Title>0.5 - 1.5 %</Title>
        <ogc:Filter><ogc:PropertyIsBetween><ogc:PropertyName>grade_pct</ogc:PropertyName><ogc:LowerBoundary><ogc:Literal>0.5</ogc:Literal></ogc:LowerBoundary><ogc:UpperBoundary><ogc:Literal>1.5</ogc:Literal></ogc:UpperBoundary></ogc:PropertyIsBetween></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#8e44ad</CssParameter><CssParameter name="fill-opacity">0.7</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>10</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>1.5 - 3 %</Name><Title>1.5 - 3 %</Title>
        <ogc:Filter><ogc:PropertyIsBetween><ogc:PropertyName>grade_pct</ogc:PropertyName><ogc:LowerBoundary><ogc:Literal>1.5</ogc:Literal></ogc:LowerBoundary><ogc:UpperBoundary><ogc:Literal>3</ogc:Literal></ogc:UpperBoundary></ogc:PropertyIsBetween></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#8e44ad</CssParameter><CssParameter name="fill-opacity">0.7</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>15</Size></Graphic></PointSymbolizer></Rule>
      <Rule><Name>over 3 %</Name><Title>over 3 %</Title>
        <ogc:Filter><ogc:PropertyIsGreaterThan><ogc:PropertyName>grade_pct</ogc:PropertyName><ogc:Literal>3</ogc:Literal></ogc:PropertyIsGreaterThan></ogc:Filter>
        <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>
          <Fill><CssParameter name="fill">#8e44ad</CssParameter><CssParameter name="fill-opacity">0.7</CssParameter></Fill>
          <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
        </Mark><Size>22</Size></Graphic></PointSymbolizer></Rule>
    </FeatureTypeStyle>
  </UserStyle></NamedLayer>
</StyledLayerDescriptor>
