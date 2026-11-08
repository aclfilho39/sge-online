package com.aclfuture.music;

import org.junit.Test;
import static org.junit.Assert.assertEquals;

public class FuzzySearchQueryTest {
    @Test public void validatesFuzzyPartialNames() {
        assertEquals("artist:mylles~1 AND artist:ke*", CatalogBridge.buildFuzzyQuery("mylles ke"));
        assertEquals("artist:engnheiros~1 AND artist:hawai~1", CatalogBridge.buildFuzzyQuery("engnheiros hawai"));
        assertEquals("artist:sufjan~1 AND artist:stvens~1", CatalogBridge.buildFuzzyQuery("Sufjan Stvens"));
        assertEquals("artist:bohemain~1 AND artist:raphsody~1", CatalogBridge.buildFuzzyQuery("Bohemain Raphsody"));
        assertEquals("", CatalogBridge.buildFuzzyQuery(" !! "));
    }
}
