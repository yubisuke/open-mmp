package dev.openmmp.sdk.max

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MaxRevenueMapperTest {
  private val mapper = MaxRevenueMapper { "installation:synthetic" }

  @Test fun `maps every documented precision and rounds USD to micros with half even`() {
    for (precision in listOf("exact", "estimated", "publisher_defined", "undefined")) {
      val payload = mapper.map(MaxRevenueObservation(0.0000025, precision, "Synthetic Network", "ad-unit:synthetic"))!!
      assertEquals("2", payload.getString("amount_unscaled"))
      assertEquals(6, payload.getInt("amount_scale"))
      assertEquals("USD", payload.getString("currency"))
      assertEquals(precision, payload.getString("revenue_precision"))
      assertEquals("installation_level", payload.getString("subject_scope"))
      assertEquals("client_estimated", payload.getString("revenue_source"))
      assertEquals("applovin-max", payload.getString("mediation_provider"))
    }
    val upperTie = mapper.map(MaxRevenueObservation(0.0000035, "exact", "Synthetic", "ad-unit:synthetic"))!!
    assertEquals("4", upperTie.getString("amount_unscaled"))
  }

  @Test fun `drops error sentinel and non-finite or undocumented values`() {
    assertNull(mapper.map(MaxRevenueObservation(-1.0, "exact", "Synthetic", "ad-unit:synthetic")))
    assertNull(mapper.map(MaxRevenueObservation(Double.NaN, "exact", "Synthetic", "ad-unit:synthetic")))
    assertNull(mapper.map(MaxRevenueObservation(0.1, "", "Synthetic", "ad-unit:synthetic")))
    assertEquals(3L, mapper.errorCount.get())
  }
}
