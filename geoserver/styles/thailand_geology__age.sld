<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc" xmlns:xlink="http://www.w3.org/1999/xlink">
  <NamedLayer><Name>thailand_geology</Name><UserStyle><Title>Geological units by age</Title>
    <FeatureTypeStyle>
      <Rule><Name>Quaternary</Name><Title>Quaternary</Title><ogc:Filter><ogc:PropertyIsLike wildCard="*" singleChar="." escapeChar="!"><ogc:PropertyName>age</ogc:PropertyName><ogc:Literal>*Quaternary*</ogc:Literal></ogc:PropertyIsLike></ogc:Filter>
        <PolygonSymbolizer><Fill><CssParameter name="fill">#fff7bc</CssParameter><CssParameter name="fill-opacity">0.8</CssParameter></Fill><Stroke><CssParameter name="stroke">#555555</CssParameter><CssParameter name="stroke-width">0.6</CssParameter></Stroke></PolygonSymbolizer></Rule>
      <Rule><Name>Cenozoic</Name><Title>Cenozoic (Tertiary)</Title><ogc:Filter><ogc:PropertyIsLike wildCard="*" singleChar="." escapeChar="!"><ogc:PropertyName>age</ogc:PropertyName><ogc:Literal>*Cenozoic*</ogc:Literal></ogc:PropertyIsLike></ogc:Filter>
        <PolygonSymbolizer><Fill><CssParameter name="fill">#fec44f</CssParameter><CssParameter name="fill-opacity">0.8</CssParameter></Fill><Stroke><CssParameter name="stroke">#555555</CssParameter><CssParameter name="stroke-width">0.6</CssParameter></Stroke></PolygonSymbolizer></Rule>
      <Rule><Name>Mesozoic</Name><Title>Mesozoic (Triassic - Cretaceous)</Title><ogc:Filter><ogc:Or><ogc:PropertyIsLike wildCard="*" singleChar="." escapeChar="!"><ogc:PropertyName>age</ogc:PropertyName><ogc:Literal>*Triassic*</ogc:Literal></ogc:PropertyIsLike><ogc:PropertyIsLike wildCard="*" singleChar="." escapeChar="!"><ogc:PropertyName>age</ogc:PropertyName><ogc:Literal>*Jurassic*</ogc:Literal></ogc:PropertyIsLike><ogc:PropertyIsLike wildCard="*" singleChar="." escapeChar="!"><ogc:PropertyName>age</ogc:PropertyName><ogc:Literal>*Cretaceous*</ogc:Literal></ogc:PropertyIsLike></ogc:Or></ogc:Filter>
        <PolygonSymbolizer><Fill><CssParameter name="fill">#7fbf7b</CssParameter><CssParameter name="fill-opacity">0.8</CssParameter></Fill><Stroke><CssParameter name="stroke">#555555</CssParameter><CssParameter name="stroke-width">0.6</CssParameter></Stroke></PolygonSymbolizer></Rule>
      <Rule><Name>Paleozoic</Name><Title>Paleozoic and older</Title><ElseFilter/>
        <PolygonSymbolizer><Fill><CssParameter name="fill">#8073ac</CssParameter><CssParameter name="fill-opacity">0.8</CssParameter></Fill><Stroke><CssParameter name="stroke">#555555</CssParameter><CssParameter name="stroke-width">0.6</CssParameter></Stroke></PolygonSymbolizer></Rule>
    </FeatureTypeStyle>
  </UserStyle></NamedLayer>
</StyledLayerDescriptor>
